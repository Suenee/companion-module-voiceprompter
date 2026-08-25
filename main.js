import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import WebSocket from 'ws'
import { randomBytes } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_VERSION = '0.12.2'
const SUPPORTED_MANIFEST_VERSION = 1
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8170
const RECONNECT_MS = 2000
const DEFAULT_HEARTBEAT_MS = 30000
const HEARTBEAT_GRACE_MS = 5000
const GRACEFUL_DISCONNECT_FLUSH_MS = 150
const LOCAL_MAILBOX = 'bc'
const TARGET_MAILBOX = 'vp'
const SERVER_MAILBOX = 'server'
const SERVER_DISCONNECT_REASONS = new Set(['shutdown', 'restart', 'exit'])
const DIAGNOSTIC_ICONS = { green: '🟢', yellow: '🟡', red: '🔴', gray: '⚪' }
const MANIFEST_DIR = join(dirname(fileURLToPath(import.meta.url)), 'manifest')

function uuidV7() {
  const b = randomBytes(16)
  const ms = BigInt(Date.now())
  b[0] = Number((ms >> 40n) & 255n)
  b[1] = Number((ms >> 32n) & 255n)
  b[2] = Number((ms >> 24n) & 255n)
  b[3] = Number((ms >> 16n) & 255n)
  b[4] = Number((ms >> 8n) & 255n)
  b[5] = Number(ms & 255n)
  b[6] = (b[6] & 15) | 112
  b[8] = (b[8] & 63) | 128
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function jsonValue(v, fallback = '') {
  if (v === undefined || v === null) return fallback
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return String(v) }
}

function isObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
function hasOnlyKeys(obj, allowed) { return Object.keys(obj).every((k) => allowed.includes(k)) }
function unicodeLength(v) { return Array.from(String(v)).length }
function deepClone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)) }
function isGoogleDocUrl(value) {
  try {
    const u = new URL(String(value))
    return u.protocol === 'https:' && u.hostname === 'docs.google.com' && u.pathname.startsWith('/document/')
  } catch { return false }
}

function getPath(root, path) {
  if (!path) return root
  return String(path).split('.').reduce((v, k) => (v == null ? undefined : v[k]), root)
}

function setPath(root, path, value) {
  const parts = String(path).split('.')
  let target = root
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (!isObject(target[key])) target[key] = {}
    target = target[key]
  }
  target[parts.at(-1)] = value
}

function interpolate(template, values) {
  return String(template).replace(/\{([^}]+)\}/g, (_m, key) => String(values[key] ?? ''))
}

function validateManifest(manifest, filename) {
  if (!isObject(manifest)) throw new Error(`${filename}: manifest root must be an object`)
  if (manifest.manifestVersion !== SUPPORTED_MANIFEST_VERSION) throw new Error(`${filename}: unsupported manifestVersion`)
  for (const key of ['id', 'name', 'version', 'description', 'namespace', 'sourceApp', 'peerLabel']) {
    if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error(`${filename}: invalid ${key}`)
  }
  if (!Number.isInteger(manifest.vppVersion) || manifest.vppVersion < 1) throw new Error(`${filename}: invalid vppVersion`)
  if (!Array.isArray(manifest.variables) || !isObject(manifest.actions) || !isObject(manifest.events)) throw new Error(`${filename}: variables/actions/events are required`)
  for (const [id, action] of Object.entries(manifest.actions)) {
    if (!isObject(action) || typeof action.name !== 'string' || typeof action.operation !== 'string') throw new Error(`${filename}: invalid action ${id}`)
    if (action.operation !== 'raw' && action.operation !== 'methodChoiceCall') {
      if (typeof action.method !== 'string' || !action.method) throw new Error(`${filename}: action ${id} is missing method`)
    }
    if (action.operation !== 'raw' && !action.queue && !action.queueByOption) throw new Error(`${filename}: action ${id} must declare queue or queueByOption`)
    if (action.queue && !['fifo', 'replace'].includes(action.queue.policy)) throw new Error(`${filename}: action ${id} has invalid queue policy`)
    if (action.queue?.policy === 'replace' && !action.queue.key && !action.queue.keyTemplate) throw new Error(`${filename}: replace action ${id} needs key/keyTemplate`)
  }
  return manifest
}

function loadManifestCatalog() {
  const catalog = new Map()
  let files = []
  try { files = readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json')).sort() } catch { return catalog }
  for (const filename of files) {
    try {
      const manifest = validateManifest(JSON.parse(readFileSync(join(MANIFEST_DIR, filename), 'utf8')), filename)
      if (catalog.has(manifest.id)) throw new Error(`duplicate manifest id ${manifest.id}`)
      catalog.set(manifest.id, manifest)
    } catch (e) {
      console.error(`Socket Universe Module: cannot load manifest ${filename}: ${e.message}`)
    }
  }
  return catalog
}

const MANIFESTS = loadManifestCatalog()

class SocketUniverseInstance extends InstanceBase {
  config = {}
  manifest = null
  roleIds = {}
  runtimeMemory = {}
  ws = null
  reconnectTimer = null
  heartbeatTimer = null
  heartbeatTimeout = null
  pendingPingId = null
  settingsSnapshotPendingId = null
  settingsSnapshotSynced = false
  destroyed = false
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS
  lastActivityAt = Date.now()
  peerConnected = false
  serverDisconnectReason = null
  lastMarkerCommand = ''
  lastMarkerArgs = []

  async init(config) {
    this.config = this.normalizeConfig(config, true)
    this.destroyed = false
    this.activateManifest(this.config.manifest)
    if (!this.manifest) {
      this.setVariableDefinitions([])
      this.setActionDefinitions({})
      this.setPresetDefinitions({})
      this.updateStatus(InstanceStatus.BadConfig, 'Select a manifest before starting Socket Universe Module')
      return
    }
    this.initializeRuntimeMemory()
    this.defineVariables()
    this.defineActions()
    this.definePresets()
    this.resetVariables()
    this.publishAllMemory()
    this.publishMarkerVariables()
    this.setHealth('gray', `Initializing ${this.manifest.name} connection`, InstanceStatus.Connecting)
    this.connect()
  }

  async destroy() {
    this.destroyed = true
    this.clearReconnect()
    this.stopHeartbeat()
    await this.announceDisconnecting('user')
    this.disconnect()
  }

  async configUpdated(config) {
    const oldManifestId = this.config?.manifest ?? 'none'
    const oldUrl = this.manifest ? this.getUrl() : ''
    const oldDynamicCounts = this.getDynamicVariableCounts()
    const oldConfig = this.config
    this.config = this.normalizeConfig(config, false)
    const manifestChanged = oldManifestId !== this.config.manifest

    if (manifestChanged) {
      await this.announceDisconnecting('user')
      this.disconnect()
      this.activateManifest(this.config.manifest)
      if (!this.manifest) {
        this.setVariableDefinitions([])
        this.setActionDefinitions({})
        this.setPresetDefinitions({})
        this.updateStatus(InstanceStatus.BadConfig, 'Select a manifest before starting Socket Universe Module')
        return
      }
      this.initializeRuntimeMemory()
      this.defineVariables()
      this.defineActions()
      this.definePresets()
      this.resetVariables()
      this.publishAllMemory()
      this.publishMarkerVariables()
      this.connect()
      return
    }

    if (!this.manifest) {
      this.updateStatus(InstanceStatus.BadConfig, 'Select a manifest before starting Socket Universe Module')
      return
    }

    const newDynamicCounts = this.getDynamicVariableCounts()
    if (JSON.stringify(oldDynamicCounts) !== JSON.stringify(newDynamicCounts)) {
      this.defineVariables()
      this.publishMarkerVariables()
    }

    const memoryChanged = this.enforceMemoryConfigLimits(oldConfig)
    if (memoryChanged) this.publishAllMemory()

    const newUrl = this.getUrl()
    if (oldUrl !== newUrl) {
      await this.announceDisconnecting('user')
      this.disconnect()
      this.connect()
    }
  }

  activateManifest(id) {
    this.manifest = id && id !== 'none' ? MANIFESTS.get(id) ?? null : null
    this.roleIds = {}
    if (this.manifest) {
      for (const variable of this.manifest.variables) if (variable.role) this.roleIds[variable.role] = variable.id
    }
  }

  normalizeConfig(config, persist = false) {
    const n = { ...(config ?? {}) }
    let changed = false
    if (typeof n.manifest !== 'string' || (!MANIFESTS.has(n.manifest) && n.manifest !== 'none')) { n.manifest = 'none'; changed = true }
    let host = String(n.host ?? '').trim()
    let port = Number(n.port)
    const apiKey = String(n.apiKey ?? '').trim()
    if ((!host || !Number.isInteger(port) || port < 1 || port > 65535) && n.url) {
      try {
        const u = new URL(String(n.url))
        if (!host && u.hostname) { host = u.hostname; changed = true }
        if (!Number.isInteger(port) || port < 1 || port > 65535) { port = Number(u.port || DEFAULT_PORT); changed = true }
      } catch {}
    }
    if (!host) { host = DEFAULT_HOST; changed = true }
    if (!Number.isInteger(port) || port < 1 || port > 65535) { port = DEFAULT_PORT; changed = true }
    n.host = host
    n.port = port
    n.apiKey = apiKey
    if ('statusBarSnapshot' in n) { delete n.statusBarSnapshot; changed = true }

    const selected = MANIFESTS.get(n.manifest)
    if (selected) {
      for (const field of selected.configFields ?? []) {
        if (field.type === 'number') {
          const value = Number(n[field.id])
          if (!Number.isInteger(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
            n[field.id] = field.default
            changed = true
          }
        } else if (n[field.id] === undefined && field.default !== undefined) {
          n[field.id] = deepClone(field.default)
          changed = true
        }
      }
    }
    if (persist && changed) this.saveConfig(n)
    return n
  }

  getConfigFields() {
    const choices = [{ id: 'none', label: 'None' }, ...[...MANIFESTS.values()].map((m) => ({ id: m.id, label: `${m.name} (${m.version})` }))]
    const fields = [
      { type: 'dropdown', id: 'manifest', label: 'Manifest', width: 12, default: 'none', choices, tooltip: 'Select the application communication manifest. SUM does not connect when None is selected.' },
      { type: 'textinput', id: 'host', label: 'SUB IP Address', width: 8, default: DEFAULT_HOST },
      { type: 'number', id: 'port', label: 'Port', width: 4, default: DEFAULT_PORT, min: 1, max: 65535, step: 1, required: true },
      { type: 'textinput', id: 'apiKey', label: 'API Key', width: 12, default: '', tooltip: 'API key used by the Socket Universe Bridge/Server connection.' },
    ]
    const selected = MANIFESTS.get(this.config?.manifest)
    const manifestFields = selected?.configFields ?? [...MANIFESTS.values()].flatMap((m) => m.configFields ?? [])
    const seen = new Set()
    for (const field of manifestFields) {
      if (seen.has(field.id)) continue
      seen.add(field.id)
      fields.push(deepClone(field))
    }
    fields.push({ type: 'checkbox', id: 'debug', label: 'Debug incoming messages', width: 6, default: false })
    return fields
  }

  getConnectionSettings() {
    let host = String(this.config?.host ?? '').trim() || DEFAULT_HOST
    let port = Number(this.config?.port)
    if (!Number.isInteger(port)) port = DEFAULT_PORT
    return { host, port, apiKey: String(this.config?.apiKey ?? '').trim() }
  }

  getUrl() {
    const { host, port, apiKey } = this.getConnectionSettings()
    const u = new URL(`ws://${host}:${port}/${LOCAL_MAILBOX}`)
    if (apiKey) u.searchParams.set('apiKey', apiKey)
    return u.toString()
  }

  getDisplayUrl() {
    const { host, port } = this.getConnectionSettings()
    return `ws://${host}:${port}/${LOCAL_MAILBOX}`
  }

  sourceInfo() {
    return { app: this.manifest?.sourceApp ?? 'SocketUniverseModule', version: MODULE_VERSION, instance: this.label || this.id }
  }

  envelope(type, recipient, extra = {}) {
    return { protocolVersion: this.manifest?.vppVersion ?? 1, id: uuidV7(), type, from: LOCAL_MAILBOX, recipient, ...extra, source: this.sourceInfo(), timestamp: new Date().toISOString() }
  }

  withQueue(extra, queue) {
    if (!queue) return extra
    return { ...extra, queue }
  }

  makeCall(method, args, expectsResponse, queue) {
    return this.envelope('call', TARGET_MAILBOX, this.withQueue({ method, args, expectsResponse }, queue))
  }

  sendVpp(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('SUB is not connected')
    this.ws.send(JSON.stringify(msg))
    if (msg.recipient === TARGET_MAILBOX) this.setRoleValues({ lastSent: new Date().toISOString() })
    if (this.config?.debug) this.log('debug', `TX VPP ${JSON.stringify(msg)}`)
  }

  sendToPeerIfAvailable(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.peerConnected) return false
    this.sendVpp(msg)
    return true
  }

  setRoleValues(roleValues) {
    if (!this.manifest) return
    const values = {}
    for (const [role, value] of Object.entries(roleValues)) {
      const id = this.roleIds[role]
      if (id) values[id] = value
    }
    if (Object.keys(values).length) this.setVariableValues(values)
  }

  initializeRuntimeMemory() {
    this.runtimeMemory = {}
    for (const [memoryId, spec] of Object.entries(this.manifest?.memory ?? {})) {
      const root = {}
      for (const [fieldId, field] of Object.entries(spec.fields ?? {})) {
        root[fieldId] = field.initialFromConfig ? deepClone(this.config[field.initialFromConfig]) : deepClone(field.initial)
      }
      this.runtimeMemory[memoryId] = root
    }
  }

  publishMemory(memoryId) {
    const spec = this.manifest?.memory?.[memoryId]
    const root = this.runtimeMemory[memoryId]
    if (!spec || root === undefined) return
    const values = {}
    for (const item of spec.publish ?? []) {
      if (item.config) values[item.variableId] = this.config[item.config] ?? ''
      else if (item.derive === 'jsonRoot') values[item.variableId] = JSON.stringify(root)
      else if (item.derive === 'enabledFromMode') {
        const v = getPath(root, item.path)
        values[item.variableId] = v == null ? (item.nullValue ?? '') : (v === item.offValue ? 0 : 1)
      } else {
        const v = getPath(root, item.path)
        values[item.variableId] = v == null ? (item.nullValue ?? '') : v
      }
    }
    if (Object.keys(values).length) this.setVariableValues(values)
  }

  publishAllMemory() {
    for (const id of Object.keys(this.manifest?.memory ?? {})) this.publishMemory(id)
  }

  publishMemoryForPath(path) {
    const memoryId = String(path).split('.')[0]
    this.publishMemory(memoryId)
  }

  enforceMemoryConfigLimits(oldConfig) {
    let changed = false
    for (const action of Object.values(this.manifest?.actions ?? {})) {
      if (action.operation !== 'memoryCountCall' || !action.maxFromConfig) continue
      const max = Number(this.config[action.maxFromConfig])
      const current = Number(getPath(this.runtimeMemory, action.memoryPath))
      if (Number.isInteger(max) && Number.isInteger(current) && current > max) {
        setPath(this.runtimeMemory, action.memoryPath, max)
        changed = true
        if (this.peerConnected) this.executeReplayForExpandedCount(action, 0, max)
      }
    }
    return changed
  }

  getDynamicVariableCounts() {
    const out = {}
    for (const d of this.manifest?.dynamicVariables ?? []) out[d.idTemplate] = Number(this.config[d.countFromConfig] ?? 0)
    return out
  }

  defineVariables() {
    if (!this.manifest) { this.setVariableDefinitions([]); return }
    const defs = this.manifest.variables.map((v) => ({ variableId: v.id, name: v.name }))
    for (const d of this.manifest.dynamicVariables ?? []) {
      const count = Math.max(0, Number(this.config[d.countFromConfig] ?? 0))
      for (let i = 0; i < count; i++) defs.push({ variableId: interpolate(d.idTemplate, { index: i }), name: interpolate(d.nameTemplate, { index: i }) })
    }
    this.setVariableDefinitions(defs)
  }

  resetVariables() {
    if (!this.manifest) return
    const values = {}
    for (const v of this.manifest.variables) {
      if (v.initialFromConfig) values[v.id] = this.config[v.initialFromConfig] ?? ''
      else if (v.initial !== undefined) values[v.id] = deepClone(v.initial)
      else values[v.id] = ''
    }
    for (const d of this.manifest.dynamicVariables ?? []) {
      const count = Math.max(0, Number(this.config[d.countFromConfig] ?? 0))
      for (let i = 0; i < count; i++) values[interpolate(d.idTemplate, { index: i })] = ''
    }
    const roleDefaults = {
      serverConnected: 0, peerConnected: 0, connectionState: 'disconnected', diagnosticLevel: 'gray', diagnosticStatus: '⚪ Connecting / unknown',
      diagnosticServer: '⚪ Connecting / unknown', diagnosticPeer: '⚪ Unknown', diagnosticReason: 'Initializing', heartbeatInterval: DEFAULT_HEARTBEAT_MS,
      protocolVersion: '', messageId: '', correlationId: '', messageType: '', from: '', recipient: '', method: '', event: '', markerCommand: '', markerArgs: '',
      argOffset: '', data: '', result: '', errorCode: '', errorMessage: '', errorDetails: '', sourceApp: '', sourceVersion: '', sourceInstance: '', timestamp: '',
      payload: '', lastReceived: '', lastSent: '', protocolError: ''
    }
    for (const [role, value] of Object.entries(roleDefaults)) if (this.roleIds[role]) values[this.roleIds[role]] = value
    this.setVariableValues(values)
  }

  publishMarkerVariables() {
    const eventSpec = this.manifest?.events?.marker
    if (!eventSpec || eventSpec.operation !== 'marker') return
    const values = {}
    if (eventSpec.commandVariableId) values[eventSpec.commandVariableId] = this.lastMarkerCommand
    if (eventSpec.argsVariableId) values[eventSpec.argsVariableId] = JSON.stringify(this.lastMarkerArgs)
    const count = Math.max(0, Number(this.config[eventSpec.directArgCountConfig] ?? 0))
    for (let i = 0; i < count; i++) values[`${eventSpec.directArgPrefix}${i}`] = this.lastMarkerArgs[i] === undefined ? '' : jsonValue(this.lastMarkerArgs[i])
    this.setVariableValues(values)
  }

  optionToCompanion(option, actionSpec) {
    const out = { ...deepClone(option) }
    delete out.arg
    delete out.parse
    delete out.values
    delete out.min
    delete out.max
    delete out.invalid
    delete out.maxUnicode
    delete out.visibleForMethodArg
    if (option.visibleForMethodArg && actionSpec.operation === 'methodChoiceCall') {
      out.isVisible = (opts) => {
        const methodId = String(opts[actionSpec.methodOption] ?? '')
        return actionSpec.methods?.[methodId]?.args?.includes(option.visibleForMethodArg) === true
      }
    }
    return out
  }

  defineActions() {
    if (!this.manifest) { this.setActionDefinitions({}); return }
    const defs = {}
    for (const [actionId, spec] of Object.entries(this.manifest.actions)) {
      defs[actionId] = {
        name: spec.name,
        ...(spec.description ? { description: spec.description } : {}),
        options: (spec.options ?? []).map((o) => this.optionToCompanion(o, spec)),
        callback: async (action) => this.executeAction(spec, action),
      }
    }
    this.setActionDefinitions(defs)
  }

  queueForAction(spec, resolved, options) {
    if (spec.queueByOption) {
      const value = String(options[spec.queueByOption.option] ?? '')
      if ((spec.queueByOption.fifoValues ?? []).includes(value)) return { policy: 'fifo' }
      return { policy: 'replace', key: spec.queueByOption.replaceKey }
    }
    if (!spec.queue) return undefined
    if (spec.queue.policy === 'fifo') return { policy: 'fifo' }
    const key = spec.queue.key ?? interpolate(spec.queue.keyTemplate, resolved)
    return { policy: 'replace', key }
  }

  async parseOption(optionSpec, raw) {
    let value = raw
    if (optionSpec.useVariables && typeof raw === 'string') value = await this.parseVariablesInString(raw)
    switch (optionSpec.parse) {
      case 'integer': {
        const n = Number(String(value ?? '').trim())
        if (!Number.isInteger(n) || (optionSpec.min !== undefined && n < optionSpec.min) || (optionSpec.max !== undefined && n > optionSpec.max)) {
          if (optionSpec.invalid === 'ignore') return { ok: false, ignore: true }
          throw new Error(`${optionSpec.label} must resolve to a valid integer`)
        }
        return { ok: true, value: n }
      }
      case 'enum': {
        const s = String(value ?? optionSpec.default ?? '')
        if (!(optionSpec.values ?? []).includes(s)) throw new Error(`Invalid ${optionSpec.label}`)
        return { ok: true, value: s }
      }
      case 'googleDocUrl': {
        const s = String(value ?? '').trim()
        if (!isGoogleDocUrl(s)) throw new Error('Google Doc URL must be an HTTPS docs.google.com/document/... URL')
        return { ok: true, value: s }
      }
      case 'string':
      default: {
        const s = String(value ?? '')
        if (optionSpec.maxUnicode !== undefined && unicodeLength(s) > optionSpec.maxUnicode) throw new Error(`${optionSpec.label} exceeds ${optionSpec.maxUnicode} characters`)
        return { ok: true, value: s }
      }
    }
  }

  async resolveActionOptions(spec, action, allowedArgIds = null) {
    const args = {}
    const resolved = {}
    for (const optionSpec of spec.options ?? []) {
      if (allowedArgIds && optionSpec.arg && !allowedArgIds.includes(optionSpec.arg)) continue
      const parsed = await this.parseOption(optionSpec, action.options[optionSpec.id] ?? optionSpec.default)
      if (!parsed.ok) return { ok: false, ignore: parsed.ignore }
      resolved[optionSpec.id] = parsed.value
      if (optionSpec.arg && (!allowedArgIds || allowedArgIds.includes(optionSpec.arg))) args[optionSpec.arg] = parsed.value
    }
    return { ok: true, args, resolved }
  }

  async executeAction(spec, action) {
    if (spec.operation === 'raw') {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('SUB is not connected')
      const payload = await this.parseVariablesInString(String(action.options.payload ?? ''))
      this.ws.send(payload)
      return
    }

    if (spec.operation === 'methodChoiceCall') {
      const methodId = String(action.options[spec.methodOption] ?? '')
      const methodSpec = spec.methods?.[methodId]
      if (!methodSpec) throw new Error('Unsupported method selection')
      const resolved = await this.resolveActionOptions(spec, action, methodSpec.args ?? [])
      if (!resolved.ok) return
      const queue = this.queueForAction(spec, resolved.resolved, action.options)
      this.sendVpp(this.makeCall(methodSpec.method, resolved.args, spec.expectsResponse === true, queue))
      return
    }

    const resolved = await this.resolveActionOptions(spec, action)
    if (!resolved.ok) return
    const queue = this.queueForAction(spec, resolved.resolved, action.options)

    if (spec.operation === 'call') {
      this.sendVpp(this.makeCall(spec.method, resolved.args, spec.expectsResponse === true, queue))
      return
    }

    if (spec.operation === 'memoryScalarCall') {
      setPath(this.runtimeMemory, spec.memoryPath, resolved.resolved[spec.valueOption])
      this.publishMemoryForPath(spec.memoryPath)
      const msg = this.makeCall(spec.method, resolved.args, spec.expectsResponse === true, queue)
      if (spec.delivery === 'peer') this.sendToPeerIfAvailable(msg); else this.sendVpp(msg)
      return
    }

    if (spec.operation === 'memoryCountCall') {
      const value = resolved.resolved[spec.valueOption]
      const max = spec.maxFromConfig ? Number(this.config[spec.maxFromConfig]) : Infinity
      if (!Number.isInteger(value) || value < 1 || value > max) return
      const previous = Number(getPath(this.runtimeMemory, spec.memoryPath)) || 0
      setPath(this.runtimeMemory, spec.memoryPath, value)
      this.publishMemoryForPath(spec.memoryPath)
      const sent = spec.delivery === 'peer'
        ? this.sendToPeerIfAvailable(this.makeCall(spec.method, resolved.args, spec.expectsResponse === true, queue))
        : (this.sendVpp(this.makeCall(spec.method, resolved.args, spec.expectsResponse === true, queue)), true)
      if (sent && value > previous) this.executeReplayForExpandedCount(spec, previous, value)
      return
    }

    if (spec.operation === 'memoryIndexedCall') {
      const index = resolved.resolved[spec.indexOption]
      const max = spec.maxFromConfig ? Number(this.config[spec.maxFromConfig]) : Infinity
      if (!Number.isInteger(index) || index < 1 || index > max) return
      const record = {}
      for (const [recordKey, optionId] of Object.entries(spec.record ?? {})) record[recordKey] = resolved.resolved[optionId]
      const map = getPath(this.runtimeMemory, spec.mapPath) ?? {}
      map[String(index)] = record
      setPath(this.runtimeMemory, spec.mapPath, map)
      this.publishMemoryForPath(spec.mapPath)
      const dynamicQueue = spec.queue?.keyTemplate ? { policy: 'replace', key: interpolate(spec.queue.keyTemplate, { ...resolved.resolved, index }) } : queue
      const msg = this.makeCall(spec.method, resolved.args, spec.expectsResponse === true, dynamicQueue)
      if (spec.delivery === 'peer') this.sendToPeerIfAvailable(msg); else this.sendVpp(msg)
      return
    }

    if (spec.operation === 'memoryClearCall') {
      setPath(this.runtimeMemory, spec.memoryPath, {})
      this.publishMemoryForPath(spec.memoryPath)
      const msg = this.makeCall(spec.method, resolved.args, spec.expectsResponse === true, queue)
      if (spec.delivery === 'peer') this.sendToPeerIfAvailable(msg); else this.sendVpp(msg)
      return
    }

    throw new Error(`Unsupported manifest action operation ${spec.operation}`)
  }

  executeReplayForExpandedCount(spec, previous, count) {
    const map = getPath(this.runtimeMemory, spec.indexedMemoryPath) ?? {}
    for (let i = Math.max(previous + 1, 1); i <= count; i++) {
      const record = map[String(i)]
      if (!record) continue
      const args = { index: i, ...record }
      const queue = { policy: 'replace', key: interpolate(spec.indexedReplayQueueKeyTemplate, { index: i }) }
      this.sendToPeerIfAvailable(this.makeCall(spec.indexedReplayMethod, args, false, queue))
    }
  }

  replayConditionMatches(condition) {
    if (!condition) return true
    const value = getPath(this.runtimeMemory, condition.memoryPath)
    if (condition.in) return condition.in.includes(value)
    if (condition.equals !== undefined) return value === condition.equals
    return true
  }

  replayArgs(argSpec, context = {}) {
    const args = {}
    for (const [argName, source] of Object.entries(argSpec ?? {})) {
      if (source.memoryPath) args[argName] = getPath(this.runtimeMemory, source.memoryPath)
      else if (source.mapKeyInteger) args[argName] = Number(context.mapKey)
      else if (source.recordPath) args[argName] = getPath(context.record, source.recordPath)
    }
    return args
  }

  executeReplay(name) {
    if (!this.peerConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    const steps = this.manifest?.replays?.[name]
    if (!Array.isArray(steps)) return false
    for (const step of steps) {
      if (!this.replayConditionMatches(step.when)) continue
      if (step.type === 'replayRef') { this.executeReplay(step.replay); continue }
      if (step.type === 'call') {
        const args = this.replayArgs(step.args)
        const queue = step.queue?.policy === 'replace' ? { policy: 'replace', key: step.queue.key } : step.queue
        this.sendVpp(this.makeCall(step.method, args, step.expectsResponse === true, queue))
        continue
      }
      if (step.type === 'repeatMapCall') {
        const map = getPath(this.runtimeMemory, step.mapPath) ?? {}
        const limit = Number(getPath(this.runtimeMemory, step.limitPath))
        for (const key of Object.keys(map).sort((a, b) => Number(a) - Number(b))) {
          const index = Number(key)
          if (!Number.isInteger(index) || (Number.isInteger(limit) && index > limit)) continue
          const args = this.replayArgs(step.args, { mapKey: key, record: map[key] })
          const queue = step.queue?.policy === 'replace' ? { policy: 'replace', key: interpolate(step.queue.keyTemplate ?? step.queue.key, { index }) } : step.queue
          this.sendVpp(this.makeCall(step.method, args, step.expectsResponse === true, queue))
        }
      }
    }
    return true
  }

  definePresets() {
    if (!this.manifest) { this.setPresetDefinitions({}); return }
    const presets = {}
    const ns = this.manifest.namespace
    for (const p of this.manifest.presets ?? []) {
      if (p.type === 'navigation') {
        const options = { instruction: p.instruction }
        if (p.offset !== undefined) options.offset = String(p.offset)
        presets[p.id] = { type: 'button', category: 'Navigation', name: p.name, style: { text: p.text, size: '18', color: 0xffffff, bgcolor: 0x000000 }, steps: [{ down: [{ actionId: 'navigation', options }], up: [] }], feedbacks: [] }
      } else if (p.type === 'diagnostics') {
        const status = this.roleIds.diagnosticStatus
        const server = this.roleIds.diagnosticServer
        const peer = this.roleIds.diagnosticPeer
        const reason = this.roleIds.diagnosticReason
        presets[p.id] = { type: 'button', category: 'Diagnostics', name: p.name, style: { text: `$(${ns}:${status})\nSUB: $(${ns}:${server})\n${this.manifest.peerLabel}: $(${ns}:${peer})\n$(${ns}:${reason})`, size: '12', color: 0xffffff, bgcolor: 0x000000 }, steps: [{ down: [], up: [] }], feedbacks: [] }
      }
    }
    this.setPresetDefinitions(presets)
  }

  connect() {
    if (!this.manifest) { this.updateStatus(InstanceStatus.BadConfig, 'Select a manifest before starting Socket Universe Module'); return }
    this.clearReconnect()
    this.stopHeartbeat()
    this.serverDisconnectReason = null
    this.settingsSnapshotPendingId = null
    this.settingsSnapshotSynced = false
    const { apiKey } = this.getConnectionSettings()
    const target = `Connecting to ${this.getDisplayUrl()}`
    this.setHealth('gray', target, InstanceStatus.Connecting)
    if (apiKey && !/^[a-fA-F0-9]{64}$/.test(apiKey)) {
      this.setHealth('red', 'API Key must be 64 hexadecimal characters', InstanceStatus.BadConfig)
      return
    }
    try { this.ws = new WebSocket(this.getUrl()) }
    catch (e) { this.setHealth('red', e.message, InstanceStatus.ConnectionFailure); this.scheduleReconnect(); return }
    this.ws.on('unexpected-response', (_req, res) => {
      const sc = res.statusCode ?? 0
      res.resume()
      const msg = sc === 401 ? 'SUB authentication failed (401)' : `SUB rejected connection (${sc})`
      this.setDisconnected()
      this.setHealth('red', msg, InstanceStatus.ConnectionFailure)
      this.scheduleReconnect()
    })
    this.ws.on('open', () => {
      this.serverDisconnectReason = null
      this.peerConnected = false
      this.settingsSnapshotSynced = false
      this.lastActivityAt = Date.now()
      this.setRoleValues({ serverConnected: 1, connectionState: 'bridge-only' })
      this.setHealth('yellow', `SUB connected; checking ${this.manifest.peerLabel} mailbox`)
      this.startHeartbeat()
      this.sendPing()
    })
    this.ws.on('message', (d) => this.handleMessage(d))
    this.ws.on('close', (c) => {
      const gracefulReason = this.serverDisconnectReason
      this.setDisconnected()
      if (gracefulReason) this.setHealth('yellow', `SUB ${gracefulReason}; reconnecting`, InstanceStatus.UnknownWarning ?? InstanceStatus.Disconnected)
      else this.setHealth('red', `SUB disconnected (${c})`, InstanceStatus.Disconnected)
      this.scheduleReconnect()
    })
    this.ws.on('error', (e) => { this.setHealth('red', `SUB WebSocket error: ${e.message}`, InstanceStatus.ConnectionFailure); this.log('error', `SUB WebSocket error: ${e.message}`) })
  }

  disconnect() {
    const s = this.ws
    this.ws = null
    if (s) { s.removeAllListeners(); try { s.close(1000) } catch {} }
    this.setDisconnected()
  }

  setDisconnected() {
    this.stopHeartbeat()
    this.peerConnected = false
    this.settingsSnapshotPendingId = null
    this.settingsSnapshotSynced = false
    this.setRoleValues({ serverConnected: 0, peerConnected: 0, connectionState: 'disconnected' })
  }

  scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer || !this.manifest) return
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; if (!this.destroyed) this.connect() }, RECONNECT_MS)
  }
  clearReconnect() { if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null } }
  startHeartbeat() { this.stopHeartbeat(); this.heartbeatTimer = setInterval(() => this.heartbeatTick(), 1000) }
  stopHeartbeat() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null }
    if (this.heartbeatTimeout) { clearTimeout(this.heartbeatTimeout); this.heartbeatTimeout = null }
    this.pendingPingId = null
  }
  heartbeatTick() { if (this.ws?.readyState === WebSocket.OPEN && !this.pendingPingId && Date.now() - this.lastActivityAt >= this.heartbeatIntervalMs) this.sendPing() }

  sendPing() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.pendingPingId) return
    const ping = this.envelope('call', SERVER_MAILBOX, { method: 'ping', args: {}, expectsResponse: true })
    this.pendingPingId = ping.id
    this.lastActivityAt = Date.now()
    this.sendVpp(ping)
    this.heartbeatTimeout = setTimeout(() => {
      if (this.pendingPingId !== ping.id) return
      this.pendingPingId = null
      this.setHealth('red', 'SUB heartbeat timeout', InstanceStatus.ConnectionFailure)
      try { this.ws?.terminate() } catch {}
    }, HEARTBEAT_GRACE_MS)
  }

  applyPingResponse(m) {
    const result = isObject(m.result) ? m.result : {}
    const mailboxes = isObject(result.mailboxes) ? result.mailboxes : {}
    const peer = isObject(mailboxes[TARGET_MAILBOX]) ? mailboxes[TARGET_MAILBOX] : {}
    const hb = isObject(result.heartbeat) ? result.heartbeat : {}
    const interval = Number(hb.intervalMs)
    if (Number.isInteger(interval) && interval >= 5000 && interval <= 3600000) this.heartbeatIntervalMs = interval
    const wasConnected = this.peerConnected
    this.peerConnected = peer.connected === true
    if (!this.peerConnected) { this.settingsSnapshotPendingId = null; this.settingsSnapshotSynced = false }
    this.lastActivityAt = Date.now()
    this.setRoleValues({ peerConnected: this.peerConnected ? 1 : 0, heartbeatInterval: this.heartbeatIntervalMs })
    this.updateConnectionStatus()
    if (this.peerConnected && !wasConnected) this.requestSettingsSnapshot()
  }

  updateConnectionStatus() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { this.setRoleValues({ connectionState: 'disconnected' }); return }
    if (this.peerConnected) {
      this.setRoleValues({ connectionState: 'connected', peerConnected: 1 })
      this.setHealth('green', `SUB + ${this.manifest.peerLabel} connected`, InstanceStatus.Ok)
    } else {
      this.setRoleValues({ connectionState: 'bridge-only', peerConnected: 0 })
      this.setHealth('yellow', `SUB connected; ${this.manifest.peerLabel} not connected`, InstanceStatus.UnknownWarning ?? InstanceStatus.Ok)
    }
  }

  getDiagnosticParts(level) {
    let server, peer
    if (this.serverDisconnectReason) server = `${DIAGNOSTIC_ICONS.yellow} ${this.serverDisconnectReason === 'restart' ? 'Restarting' : this.serverDisconnectReason === 'shutdown' ? 'Shutting down' : 'Exiting'}`
    else if (this.ws?.readyState === WebSocket.OPEN) server = `${DIAGNOSTIC_ICONS.green} Connected`
    else if (level === 'gray') server = `${DIAGNOSTIC_ICONS.gray} Connecting / unknown`
    else server = `${DIAGNOSTIC_ICONS.red} Disconnected`
    if (this.ws?.readyState === WebSocket.OPEN) peer = this.peerConnected ? `${DIAGNOSTIC_ICONS.green} Connected` : `${DIAGNOSTIC_ICONS.yellow} Disconnected`
    else peer = `${DIAGNOSTIC_ICONS.gray} Unknown`
    return { server, peer }
  }

  setHealth(level, reason, statusOverride = null) {
    if (!DIAGNOSTIC_ICONS[level]) level = 'gray'
    const label = level === 'green' ? 'Connected' : level === 'yellow' ? 'Warning' : level === 'red' ? 'Error' : 'Connecting / unknown'
    const parts = this.getDiagnosticParts(level)
    this.setRoleValues({ diagnosticLevel: level, diagnosticStatus: `${DIAGNOSTIC_ICONS[level]} ${label}`, diagnosticServer: parts.server, diagnosticPeer: parts.peer, diagnosticReason: String(reason ?? '') })
    const status = statusOverride ?? (level === 'green' ? InstanceStatus.Ok : level === 'yellow' ? (InstanceStatus.UnknownWarning ?? InstanceStatus.Ok) : level === 'red' ? InstanceStatus.ConnectionFailure : InstanceStatus.Connecting)
    this.updateStatus(status, String(reason ?? label))
  }

  async announceDisconnecting(reason = 'user') {
    const s = this.ws
    if (!s || s.readyState !== WebSocket.OPEN || !this.manifest) return
    const msg = this.envelope('event', TARGET_MAILBOX, { event: 'disconnecting', args: { reason }, expectsResponse: false, queue: { policy: 'fifo' } })
    const payload = JSON.stringify(msg)
    this.setRoleValues({ lastSent: new Date().toISOString() })
    if (this.config?.debug) this.log('debug', `TX VPP ${payload}`)
    await new Promise((resolve) => {
      let finished = false
      const finish = () => { if (finished) return; finished = true; clearTimeout(timer); resolve() }
      const timer = setTimeout(finish, GRACEFUL_DISCONNECT_FLUSH_MS)
      try { s.send(payload, finish) } catch { finish() }
    })
  }

  protocolFailure(text, raw = '') {
    this.log('error', `VPP ERROR: ${text}`)
    this.setRoleValues({ protocolError: text, payload: raw, lastReceived: new Date().toISOString() })
  }

  sendAck(m, result = { success: true }) { this.sendVpp(this.envelope('response', String(m.from), { correlationId: m.id, result })) }
  sendError(m, code, message, details) { this.sendVpp(this.envelope('error', String(m.from), { correlationId: m.id, error: { code, message, ...(details === undefined ? {} : { details }) } })) }

  validateEnvelope(m) {
    if (Number(m.protocolVersion) !== this.manifest.vppVersion) return 'Unsupported protocolVersion'
    if (typeof m.id !== 'string' || !m.id) return 'Missing message id'
    if (typeof m.type !== 'string') return 'Missing message type'
    if (!['call', 'event', 'progress', 'response', 'error'].includes(m.type)) return `Unknown message type "${m.type}"`
    if (![TARGET_MAILBOX, SERVER_MAILBOX].includes(m.from)) return `Invalid from "${m.from}"`
    if (m.recipient !== LOCAL_MAILBOX) return `Message recipient must be "${LOCAL_MAILBOX}"`
    if (!isObject(m.source)) return 'Missing or invalid source'
    if (typeof m.timestamp !== 'string' || !m.timestamp.trim()) return 'Missing or invalid timestamp'
    return null
  }

  validateTerminalCorrelation(m) {
    if ((m.type === 'progress' || m.type === 'response') && (typeof m.correlationId !== 'string' || !m.correlationId)) return `${m.type} is missing correlationId`
    if (m.type === 'error' && m.correlationId !== undefined && typeof m.correlationId !== 'string') return 'error correlationId must be a string'
    return null
  }

  markValidPeerActivity(m) {
    if (m.from !== TARGET_MAILBOX) return
    const wasConnected = this.peerConnected
    this.lastActivityAt = Date.now()
    this.peerConnected = true
    this.updateConnectionStatus()
    if (!wasConnected) this.requestSettingsSnapshot()
  }

  validateTypedValue(spec, value) {
    if (!spec) return false
    if (spec.type === 'string') return typeof value === 'string'
    if (spec.type === 'integer') return Number.isInteger(value) && (spec.min === undefined || value >= spec.min) && (spec.max === undefined || value <= spec.max)
    if (spec.type === 'enum') return typeof value === 'string' && (spec.values ?? []).includes(value)
    return false
  }

  validateArgsAgainstSchema(args, schema) {
    if (!isObject(args) || !isObject(schema) || !hasOnlyKeys(args, Object.keys(schema))) return false
    if (Object.keys(args).length !== Object.keys(schema).length) return false
    for (const [key, spec] of Object.entries(schema)) if (!this.validateTypedValue(spec, args[key])) return false
    return true
  }

  applySetting(setting, value) {
    const spec = this.manifest?.settings?.values?.[setting]
    if (!spec || !this.validateTypedValue(spec, value)) return false
    this.setVariableValues({ [spec.variableId]: value })
    return true
  }

  requestSettingsSnapshot() {
    const method = this.manifest?.settings?.snapshotMethod
    if (!method || !this.peerConnected || this.settingsSnapshotPendingId || this.settingsSnapshotSynced || !this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const msg = this.makeCall(method, {}, true, { policy: 'fifo' })
    this.settingsSnapshotPendingId = msg.id
    this.sendVpp(msg)
  }

  handleSettingsResponse(m) {
    if (m.type !== 'response' || !isObject(m.result)) return false
    if (m.correlationId === this.settingsSnapshotPendingId) {
      const settings = m.result.settings
      const defs = this.manifest.settings?.values ?? {}
      this.settingsSnapshotPendingId = null
      if (!isObject(settings) || !hasOnlyKeys(settings, Object.keys(defs)) || Object.keys(settings).length !== Object.keys(defs).length) {
        this.protocolFailure('Invalid settings snapshot response', JSON.stringify(m))
        return true
      }
      for (const [setting, spec] of Object.entries(defs)) if (!this.validateTypedValue(spec, settings[setting])) {
        this.protocolFailure(`Invalid settings snapshot value for ${setting}`, JSON.stringify(m))
        return true
      }
      const values = {}
      for (const [setting, spec] of Object.entries(defs)) values[spec.variableId] = settings[setting]
      this.setVariableValues(values)
      this.settingsSnapshotSynced = true
      return true
    }
    if (typeof m.result.setting === 'string' && Object.prototype.hasOwnProperty.call(m.result, 'value')) {
      if (!hasOnlyKeys(m.result, ['setting', 'value']) || !this.applySetting(m.result.setting, m.result.value)) this.protocolFailure('Invalid synchronized setting response', JSON.stringify(m))
      return true
    }
    return false
  }

  handleManifestEvent(m, raw) {
    const spec = this.manifest.events?.[m.event]
    if (!spec) return { handled: false }
    if (spec.expectsResponse === true && m.expectsResponse !== true) return { handled: true, valid: false, error: 'Event requires expectsResponse:true' }
    if (spec.expectsResponse === false && m.expectsResponse === true) return { handled: true, valid: false, error: 'Event requires expectsResponse:false' }

    if (spec.operation === 'marker') {
      if (m.from !== TARGET_MAILBOX || typeof m.command !== 'string' || !m.command.trim() || !Array.isArray(m.args)) return { handled: true, valid: false, error: 'Invalid marker event' }
      for (const a of m.args) if (!['string', 'number'].includes(typeof a) || (typeof a === 'number' && !Number.isFinite(a))) return { handled: true, valid: false, error: 'Invalid marker argument', code: 'INVALID_ARGUMENT' }
      this.lastMarkerCommand = m.command
      this.lastMarkerArgs = [...m.args]
      this.publishMarkerVariables()
      return { handled: true, valid: true }
    }

    if (spec.operation === 'mapArgsToVariables') {
      if (m.from !== TARGET_MAILBOX || !this.validateArgsAgainstSchema(m.args, spec.args)) return { handled: true, valid: false, error: `Invalid ${m.event} event` }
      const values = {}
      for (const [arg, variableId] of Object.entries(spec.map ?? {})) values[variableId] = m.args[arg]
      this.setVariableValues(values)
      return { handled: true, valid: true }
    }

    if (spec.operation === 'settingChanged') {
      if (m.from !== TARGET_MAILBOX || !isObject(m.args) || !hasOnlyKeys(m.args, ['setting', 'value']) || typeof m.args.setting !== 'string' || !this.applySetting(m.args.setting, m.args.value)) return { handled: true, valid: false, error: 'Invalid settingChanged event' }
      return { handled: true, valid: true }
    }

    if (spec.operation === 'memoryUpdateAndReplay') {
      if (m.from !== TARGET_MAILBOX || !this.validateArgsAgainstSchema(m.args, spec.args)) return { handled: true, valid: false, error: `Invalid ${m.event} event` }
      this.markValidPeerActivity(m)
      setPath(this.runtimeMemory, spec.memoryPath, m.args[spec.fromArg])
      this.publishMemoryForPath(spec.memoryPath)
      const skip = spec.replayUnless && m.args[spec.replayUnless.arg] === spec.replayUnless.equals
      if (!skip) this.executeReplay(spec.replay)
      return { handled: true, valid: true }
    }

    if (spec.operation === 'memorySyncRequest') {
      if (m.from !== TARGET_MAILBOX || !this.validateArgsAgainstSchema(m.args, spec.args) || m.expectsResponse !== true) return { handled: true, valid: false, error: `Invalid ${m.event} event` }
      this.markValidPeerActivity(m)
      const current = getPath(this.runtimeMemory, spec.bootstrap.memoryPath)
      if (!spec.bootstrap.onlyIfNull || current == null) {
        setPath(this.runtimeMemory, spec.bootstrap.memoryPath, m.args[spec.bootstrap.fromArg])
        this.publishMemoryForPath(spec.bootstrap.memoryPath)
      }
      const mode = getPath(this.runtimeMemory, spec.availability.modePath)
      let available = spec.availability.validModes.includes(mode)
      if (available && spec.availability.visibleModes.includes(mode)) {
        const count = Number(getPath(this.runtimeMemory, spec.availability.countPath))
        available = Number.isInteger(count) && count >= 1
      }
      if (available) this.executeReplay(spec.replay)
      this.sendAck(m, { available })
      return { handled: true, valid: true, ackHandled: true }
    }

    return { handled: true, valid: false, error: `Unsupported event operation ${spec.operation}` }
  }

  handleMessage(rawData) {
    const raw = Buffer.isBuffer(rawData) ? rawData.toString('utf8') : String(rawData)
    let m
    try { m = JSON.parse(raw) } catch { this.protocolFailure('Received invalid JSON', raw); return }
    if (!isObject(m)) { this.protocolFailure('JSON root must be an object', raw); return }
    const envErr = this.validateEnvelope(m)
    if (envErr) { this.protocolFailure(envErr, raw); return }
    const corrErr = this.validateTerminalCorrelation(m)
    if (corrErr) { this.protocolFailure(corrErr, raw); return }

    if (this.pendingPingId && m.from === SERVER_MAILBOX && m.correlationId === this.pendingPingId && (m.type === 'response' || m.type === 'error')) {
      if (this.heartbeatTimeout) { clearTimeout(this.heartbeatTimeout); this.heartbeatTimeout = null }
      this.pendingPingId = null
      this.lastActivityAt = Date.now()
      if (m.type === 'response') this.applyPingResponse(m)
    }

    if (m.type === 'error' && m.correlationId === this.settingsSnapshotPendingId) {
      this.settingsSnapshotPendingId = null
      this.settingsSnapshotSynced = false
    }
    if (m.from === TARGET_MAILBOX && m.type === 'response') this.handleSettingsResponse(m)

    let argOffset = ''
    let eventAckHandled = false
    let isPeerDisconnecting = false

    if (m.type === 'event') {
      if (typeof m.event !== 'string' || !m.event) { this.protocolFailure('Event name is missing', raw); return }
      if (m.event === 'disconnecting') {
        if (!isObject(m.args) || !hasOnlyKeys(m.args, ['reason']) || typeof m.args.reason !== 'string') {
          if (m.expectsResponse === true) this.sendError(m, 'INVALID_MESSAGE', 'Invalid disconnecting event')
          this.protocolFailure('Invalid disconnecting event', raw); return
        }
        const reason = m.args.reason
        if (m.from === TARGET_MAILBOX) {
          if (reason !== 'user') { if (m.expectsResponse === true) this.sendError(m, 'INVALID_ARGUMENT', 'Invalid peer disconnecting reason'); this.protocolFailure('Invalid peer disconnecting reason', raw); return }
          isPeerDisconnecting = true
          this.peerConnected = false
          this.settingsSnapshotPendingId = null
          this.settingsSnapshotSynced = false
          this.setRoleValues({ peerConnected: 0, connectionState: 'bridge-only' })
          this.setHealth('yellow', `${this.manifest.peerLabel} announced intentional disconnect`, InstanceStatus.UnknownWarning ?? InstanceStatus.Ok)
        } else if (m.from === SERVER_MAILBOX) {
          if (!SERVER_DISCONNECT_REASONS.has(reason)) { if (m.expectsResponse === true) this.sendError(m, 'INVALID_ARGUMENT', 'Invalid server disconnecting reason'); this.protocolFailure('Invalid server disconnecting reason', raw); return }
          this.serverDisconnectReason = reason
          this.stopHeartbeat()
          this.peerConnected = false
          this.settingsSnapshotPendingId = null
          this.settingsSnapshotSynced = false
          this.setRoleValues({ serverConnected: 0, peerConnected: 0, connectionState: 'disconnected' })
          this.setHealth('yellow', `SUB ${reason}; reconnecting`, InstanceStatus.UnknownWarning ?? InstanceStatus.Disconnected)
        }
      } else {
        const result = this.handleManifestEvent(m, raw)
        if (!result.handled) {
          if (m.expectsResponse === true) this.sendError(m, 'INVALID_MESSAGE', `Unknown event "${m.event}"`)
          this.protocolFailure(`Unknown event "${m.event}"`, raw); return
        }
        if (!result.valid) {
          if (m.expectsResponse === true) this.sendError(m, result.code ?? 'INVALID_MESSAGE', result.error)
          this.protocolFailure(result.error, raw); return
        }
        eventAckHandled = result.ackHandled === true
      }
    }

    if (m.type === 'call') {
      if (typeof m.method !== 'string' || !isObject(m.args)) { if (m.expectsResponse === true) this.sendError(m, 'INVALID_MESSAGE', 'Invalid call'); this.protocolFailure('Invalid call', raw); return }
      if (m.expectsResponse === true) this.sendError(m, 'UNKNOWN_METHOD', `SUM has no public method "${m.method}"`)
    }

    if (m.from === TARGET_MAILBOX && !isPeerDisconnecting) this.markValidPeerActivity(m)

    const source = m.source
    const error = isObject(m.error) ? m.error : {}
    const callArgs = m.type === 'call' && isObject(m.args) ? m.args : {}
    if (callArgs.offset !== undefined) argOffset = jsonValue(callArgs.offset)
    this.setRoleValues({
      protocolVersion: this.manifest.vppVersion, messageId: m.id, correlationId: m.correlationId ?? '', messageType: m.type, from: m.from, recipient: m.recipient,
      method: m.method ?? '', event: m.event ?? '', argOffset, data: jsonValue(m.data), result: jsonValue(m.result), errorCode: error.code ?? '', errorMessage: error.message ?? '',
      errorDetails: jsonValue(error.details), sourceApp: source.app ?? '', sourceVersion: source.version ?? '', sourceInstance: source.instance ?? '', timestamp: m.timestamp,
      payload: raw, lastReceived: new Date().toISOString(), protocolError: ''
    })
    if (m.type === 'event' && m.expectsResponse === true && !eventAckHandled) this.sendAck(m)
    if (this.config?.debug) this.log('debug', `RX VPP ${raw}`)
  }
}

runEntrypoint(SocketUniverseInstance, [])
