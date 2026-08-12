import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base'
import WebSocket from 'ws'
import { randomBytes } from 'node:crypto'

const MODULE_VERSION = '0.8.0'
const PROTOCOL_VERSION = 1
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 8170
const RECONNECT_MS = 2000
const DEFAULT_HEARTBEAT_MS = 30000
const HEARTBEAT_GRACE_MS = 5000

const NAV_METHODS = {
  GO_START: ['goStart', false],
  MARKER_BACK: ['markerBack', true],
  GO_BACK: ['goBack', true],
  GO_CURRENT: ['goCurrent', true],
  GO_NEXT: ['goNext', true],
  MARKER_NEXT: ['markerNext', true],
  GO_FINISH: ['goFinish', false],
}

function uuidV7() {
  const b = randomBytes(16), ms = BigInt(Date.now())
  b[0]=Number((ms>>40n)&255n); b[1]=Number((ms>>32n)&255n); b[2]=Number((ms>>24n)&255n); b[3]=Number((ms>>16n)&255n); b[4]=Number((ms>>8n)&255n); b[5]=Number(ms&255n)
  b[6]=(b[6]&15)|112; b[8]=(b[8]&63)|128
  const h=b.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}
function jsonValue(v, fallback=''){if(v===undefined||v===null)return fallback;if(typeof v==='string')return v;try{return JSON.stringify(v)}catch{return String(v)}}
function isObject(v){return !!v && typeof v==='object' && !Array.isArray(v)}

class VoicePrompterInstance extends InstanceBase {
  config={}; ws=null; reconnectTimer=null; heartbeatTimer=null; heartbeatTimeout=null; pendingPingId=null; destroyed=false
  heartbeatIntervalMs=DEFAULT_HEARTBEAT_MS; lastPeerActivity=Date.now(); peerConnected=false

  async init(config){this.config=this.normalizeConfig(config,true);this.destroyed=false;this.defineVariables();this.defineActions();this.definePresets();this.resetVariables();this.connect()}
  async destroy(){this.destroyed=true;this.clearReconnect();this.stopHeartbeat();this.disconnect()}
  async configUpdated(config){const old=this.getUrl();this.config=this.normalizeConfig(config,true);if(old!==this.getUrl()){this.disconnect();this.connect()}}

  normalizeConfig(config,persist=false){const n={...(config??{})};let changed=false;let host=String(n.host??'').trim(),port=Number(n.port),apiKey=String(n.apiKey??'').trim();if((!host||!Number.isInteger(port)||port<1||port>65535)&&n.url){try{const u=new URL(String(n.url));if(!host&&u.hostname){host=u.hostname;changed=true}if(!Number.isInteger(port)||port<1||port>65535){port=Number(u.port||DEFAULT_PORT);changed=true}}catch{}}if(!host){host=DEFAULT_HOST;changed=true}if(!Number.isInteger(port)||port<1||port>65535){port=DEFAULT_PORT;changed=true}n.host=host;n.port=port;n.apiKey=apiKey;if(persist&&changed)this.saveConfig(n);return n}
  getConfigFields(){return[{type:'textinput',id:'host',label:'VPBridge IP Address',width:8,default:DEFAULT_HOST},{type:'number',id:'port',label:'Port',width:4,default:DEFAULT_PORT,min:1,max:65535,step:1,required:true},{type:'textinput',id:'apiKey',label:'API Key',width:12,default:'',tooltip:'Required when VPBridge is set to All Interfaces. Leave empty for Local only.'},{type:'checkbox',id:'debug',label:'Debug incoming messages',width:6,default:false}]}
  getConnectionSettings(){let host=String(this.config?.host??'').trim()||DEFAULT_HOST,port=Number(this.config?.port);if(!Number.isInteger(port))port=DEFAULT_PORT;return{host,port,apiKey:String(this.config?.apiKey??'').trim()}}
  getUrl(){const{host,port,apiKey}=this.getConnectionSettings();const u=new URL(`ws://${host}:${port}/bc`);if(apiKey)u.searchParams.set('apiKey',apiKey);return u.toString()}
  getDisplayUrl(){const{host,port}=this.getConnectionSettings();return `ws://${host}:${port}/bc`}
  sourceInfo(){return{app:'VoicePrompterModule',version:MODULE_VERSION,instance:this.label||this.id}}
  envelope(type,recipient,extra={}){return{protocolVersion:PROTOCOL_VERSION,id:uuidV7(),type,from:'bc',recipient,...extra,source:this.sourceInfo(),timestamp:new Date().toISOString()}}
  sendVpp(msg){if(!this.ws||this.ws.readyState!==WebSocket.OPEN)throw new Error('VPBridge is not connected');this.ws.send(JSON.stringify(msg));if(msg.recipient==='vp')this.setVariableValues({last_sent:new Date().toISOString()});if(this.config?.debug)this.log('debug',`TX VPP ${JSON.stringify(msg)}`)}

  defineVariables(){this.setVariableDefinitions([
    {variableId:'connected',name:'VPBridge connected (1/0)'},{variableId:'vp_connected',name:'VoicePrompter mailbox connected (1/0)'},{variableId:'connection_state',name:'Connection state'},
    {variableId:'heartbeat_interval_ms',name:'Heartbeat interval ms'},{variableId:'protocol_version',name:'Protocol version'},{variableId:'id',name:'Message ID'},{variableId:'correlation_id',name:'Correlation ID'},
    {variableId:'type',name:'Message type'},{variableId:'from',name:'From mailbox'},{variableId:'recipient',name:'Recipient mailbox'},{variableId:'method',name:'Call method'},{variableId:'event',name:'Event name'},
    {variableId:'command',name:'Marker command'},{variableId:'marker_args',name:'Marker arguments JSON'},{variableId:'arg_offset',name:'Call args.offset'},
    {variableId:'data',name:'Data JSON'},{variableId:'result',name:'Result JSON'},{variableId:'error_code',name:'Error code'},{variableId:'error_message',name:'Error message'},{variableId:'error_details',name:'Error details JSON'},
    {variableId:'source_app',name:'Source application'},{variableId:'source_version',name:'Source application version'},{variableId:'source_instance',name:'Source instance'},{variableId:'timestamp',name:'Protocol timestamp'},
    {variableId:'payload',name:'Complete JSON payload'},{variableId:'last_received',name:'Local receive timestamp'},{variableId:'last_sent',name:'Local send timestamp'},{variableId:'protocol_error',name:'Last VPP validation error'}
  ])}
  resetVariables(){this.setVariableValues({connected:0,vp_connected:0,connection_state:'disconnected',heartbeat_interval_ms:DEFAULT_HEARTBEAT_MS,protocol_version:'',id:'',correlation_id:'',type:'',from:'',recipient:'',method:'',event:'',command:'',marker_args:'',arg_offset:'',data:'',result:'',error_code:'',error_message:'',error_details:'',source_app:'',source_version:'',source_instance:'',timestamp:'',payload:'',last_received:'',last_sent:'',protocol_error:''})}

  defineActions(){const choices=[{id:'GO_START',label:'Go Start'},{id:'MARKER_BACK',label:'Marker Back'},{id:'GO_BACK',label:'Go Back'},{id:'GO_CURRENT',label:'Go Current'},{id:'GO_NEXT',label:'Go Next'},{id:'MARKER_NEXT',label:'Marker Next'},{id:'GO_FINISH',label:'Go Finish'}];this.setActionDefinitions({
    navigation:{name:'Navigation',options:[{type:'dropdown',id:'instruction',label:'Instruction',choices,default:'GO_NEXT'},{type:'textinput',id:'offset',label:'Offset',default:'1',useVariables:true,multiline:true,isVisible:o=>NAV_METHODS[String(o.instruction??'GO_NEXT')]?.[1]===true}],callback:async action=>{const entry=NAV_METHODS[String(action.options.instruction??'GO_NEXT')];if(!entry)throw new Error('Unsupported Navigation instruction');const[method,usesOffset]=entry,args={};if(usesOffset){const raw=await this.parseVariablesInString(String(action.options.offset??'')),offset=Number(String(raw).trim());if(!Number.isInteger(offset))throw new Error('Navigation offset must resolve to an integer');args.offset=offset}this.sendVpp(this.envelope('call','vp',{method,args,expectsResponse:true}))}},
    json:{name:'JSON',description:'Temporary raw WebSocket test action.',options:[{type:'textinput',id:'payload',label:'JSON / Text',default:'',useVariables:true,multiline:true}],callback:async action=>{if(!this.ws||this.ws.readyState!==WebSocket.OPEN)throw new Error('VPBridge is not connected');const resolved=await this.parseVariablesInString(String(action.options.payload??''));this.ws.send(resolved)}}
  })}
  definePresets(){const p=(name,text,instruction,offset)=>{const options={instruction};if(offset!==undefined)options.offset=String(offset);return{type:'button',category:'Navigation',name,style:{text,size:'18',color:0xffffff,bgcolor:0x000000},steps:[{down:[{actionId:'navigation',options}],up:[]}],feedbacks:[]}};this.setPresetDefinitions({navigation_go_start:p('Go Start','|<\nGo Start','GO_START'),navigation_marker_back:p('Marker Back','[<\nMarker Back','MARKER_BACK',1),navigation_go_back:p('Go Back','<<\nGo Back','GO_BACK',1),navigation_go_current:p('Go Current','<|\nGo Current','GO_CURRENT',1),navigation_go_next:p('Go Next','>>\nGo Next','GO_NEXT',1),navigation_marker_next:p('Marker Next','>]\nMarker Next','MARKER_NEXT',1),navigation_go_finish:p('Go Finish','>|\nGo Finish','GO_FINISH')})}

  connect(){this.clearReconnect();this.stopHeartbeat();const{apiKey}=this.getConnectionSettings();if(apiKey&&!/^[a-fA-F0-9]{64}$/.test(apiKey)){this.updateStatus(InstanceStatus.BadConfig,'API Key must be 64 hexadecimal characters');return}this.updateStatus(InstanceStatus.Connecting,`Connecting to ${this.getDisplayUrl()}`);try{this.ws=new WebSocket(this.getUrl())}catch(e){this.updateStatus(InstanceStatus.ConnectionFailure,e.message);this.scheduleReconnect();return}
    this.ws.on('unexpected-response',(_req,res)=>{const sc=res.statusCode??0;res.resume();this.setDisconnected();this.updateStatus(InstanceStatus.ConnectionFailure,sc===401?'VPBridge authentication failed (401)':`VPBridge rejected connection (${sc})`);this.scheduleReconnect()})
    this.ws.on('open',()=>{this.setVariableValues({connected:1,connection_state:'bridge-only'});this.peerConnected=false;this.lastPeerActivity=Date.now();this.updateConnectionStatus();this.startHeartbeat();this.sendPing()})
    this.ws.on('message',d=>this.handleMessage(d));this.ws.on('close',c=>{this.setDisconnected();this.updateStatus(InstanceStatus.Disconnected,`VPBridge disconnected (${c})`);this.scheduleReconnect()});this.ws.on('error',e=>this.log('error',`VPBridge WebSocket error: ${e.message}`))}
  disconnect(){const s=this.ws;this.ws=null;if(s){s.removeAllListeners();try{s.close(1000)}catch{}}this.setDisconnected()}
  setDisconnected(){this.stopHeartbeat();this.peerConnected=false;this.setVariableValues({connected:0,vp_connected:0,connection_state:'disconnected'})}
  scheduleReconnect(){if(this.destroyed||this.reconnectTimer)return;this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;if(!this.destroyed)this.connect()},RECONNECT_MS)}
  clearReconnect(){if(this.reconnectTimer){clearTimeout(this.reconnectTimer);this.reconnectTimer=null}}

  startHeartbeat(){this.stopHeartbeat();this.heartbeatTimer=setInterval(()=>this.heartbeatTick(),1000)}
  stopHeartbeat(){if(this.heartbeatTimer){clearInterval(this.heartbeatTimer);this.heartbeatTimer=null}if(this.heartbeatTimeout){clearTimeout(this.heartbeatTimeout);this.heartbeatTimeout=null}this.pendingPingId=null}
  heartbeatTick(){if(!this.ws||this.ws.readyState!==WebSocket.OPEN||this.pendingPingId)return;if(Date.now()-this.lastPeerActivity>=this.heartbeatIntervalMs)this.sendPing()}
  sendPing(){if(!this.ws||this.ws.readyState!==WebSocket.OPEN||this.pendingPingId)return;const ping=this.envelope('call','server',{method:'ping',args:{},expectsResponse:true});this.pendingPingId=ping.id;this.sendVpp(ping);this.heartbeatTimeout=setTimeout(()=>{if(this.pendingPingId!==ping.id)return;this.pendingPingId=null;this.updateStatus(InstanceStatus.ConnectionFailure,'VPBridge heartbeat timeout');try{this.ws?.terminate()}catch{}},HEARTBEAT_GRACE_MS)}
  applyPingResponse(m){const result=isObject(m.result)?m.result:{},mailboxes=isObject(result.mailboxes)?result.mailboxes:{},vp=isObject(mailboxes.vp)?mailboxes.vp:{},hb=isObject(result.heartbeat)?result.heartbeat:{};const interval=Number(hb.intervalMs);if(Number.isInteger(interval)&&interval>=5000&&interval<=3600000)this.heartbeatIntervalMs=interval;this.peerConnected=vp.connected===true;this.setVariableValues({vp_connected:this.peerConnected?1:0,heartbeat_interval_ms:this.heartbeatIntervalMs});this.updateConnectionStatus()}
  updateConnectionStatus(){if(!this.ws||this.ws.readyState!==WebSocket.OPEN){this.setVariableValues({connection_state:'disconnected'});return}if(this.peerConnected){this.setVariableValues({connection_state:'connected',vp_connected:1});this.updateStatus(InstanceStatus.Ok,'VPBridge + VoicePrompter connected')}else{this.setVariableValues({connection_state:'bridge-only',vp_connected:0});this.updateStatus(InstanceStatus.UnknownWarning??InstanceStatus.Ok,'VPBridge connected; VoicePrompter not connected')}}

  protocolFailure(text,raw=''){this.log('error',`VPP ERROR: ${text}`);this.setVariableValues({protocol_error:text,payload:raw,last_received:new Date().toISOString()})}
  sendAck(m,result={success:true}){this.sendVpp(this.envelope('response',String(m.from),{correlationId:m.id,result}))}
  sendError(m,code,message,details){this.sendVpp(this.envelope('error',String(m.from),{correlationId:m.id,error:{code,message,...(details===undefined?{}:{details})}}))}

  validateEnvelope(m){if(Number(m.protocolVersion)!==PROTOCOL_VERSION)return'Unsupported protocolVersion';if(typeof m.id!=='string'||!m.id)return'Missing message id';if(typeof m.type!=='string')return'Missing message type';if(!['call','event','progress','response','error'].includes(m.type))return`Unknown message type "${m.type}"`;if(!['vp','server'].includes(m.from))return`Invalid from "${m.from}"`;if(m.recipient!=='bc')return`Message recipient must be "bc"`;return null}
  handleMessage(rawData){const raw=Buffer.isBuffer(rawData)?rawData.toString('utf8'):String(rawData);let m;try{m=JSON.parse(raw)}catch{this.protocolFailure('Received invalid JSON',raw);return}if(!isObject(m)){this.protocolFailure('JSON root must be an object',raw);return}const envErr=this.validateEnvelope(m);if(envErr){this.protocolFailure(envErr,raw);return}
    if(m.from==='vp'){this.lastPeerActivity=Date.now();this.peerConnected=true;this.updateConnectionStatus()}
    if(this.pendingPingId&&m.from==='server'&&m.correlationId===this.pendingPingId&&(m.type==='response'||m.type==='error')){if(this.heartbeatTimeout){clearTimeout(this.heartbeatTimeout);this.heartbeatTimeout=null}this.pendingPingId=null;if(m.type==='response')this.applyPingResponse(m)}

    if((m.type==='progress'||m.type==='response')&&(typeof m.correlationId!=='string'||!m.correlationId)){this.protocolFailure(`${m.type} is missing correlationId`,raw);return}
    if(m.type==='error'&&m.correlationId!==undefined&&typeof m.correlationId!=='string'){this.protocolFailure('error correlationId must be a string',raw);return}

    let command='',markerArgs='',argOffset='';
    if(m.type==='event'){
      if(m.event!=='marker'){if(m.expectsResponse===true)this.sendError(m,'INVALID_MESSAGE',`Unknown event "${m.event}"`);this.protocolFailure(`Unknown event "${m.event}"`,raw);return}
      if(typeof m.command!=='string'||!m.command.trim()||!Array.isArray(m.args)){if(m.expectsResponse===true)this.sendError(m,'INVALID_MESSAGE','Invalid marker event');this.protocolFailure('Invalid marker event',raw);return}
      for(const a of m.args)if(!['string','number'].includes(typeof a)||typeof a==='number'&&!Number.isFinite(a)){if(m.expectsResponse===true)this.sendError(m,'INVALID_ARGUMENT','Invalid marker argument');this.protocolFailure('Invalid marker argument',raw);return}
      command=m.command;markerArgs=JSON.stringify(m.args)
    }
    if(m.type==='call'){
      if(typeof m.method!=='string'||!isObject(m.args)){if(m.expectsResponse===true)this.sendError(m,'INVALID_MESSAGE','Invalid call');this.protocolFailure('Invalid call',raw);return}
      if(m.expectsResponse===true)this.sendError(m,'UNKNOWN_METHOD',`VPM has no public method "${m.method}"`)
    }
    const source=isObject(m.source)?m.source:{},error=isObject(m.error)?m.error:{},callArgs=m.type==='call'&&isObject(m.args)?m.args:{};if(callArgs.offset!==undefined)argOffset=jsonValue(callArgs.offset)
    this.setVariableValues({protocol_version:PROTOCOL_VERSION,id:m.id,correlation_id:m.correlationId??'',type:m.type,from:m.from,recipient:m.recipient,method:m.method??'',event:m.event??'',command,marker_args:markerArgs,arg_offset:argOffset,data:jsonValue(m.data),result:jsonValue(m.result),error_code:error.code??'',error_message:error.message??'',error_details:jsonValue(error.details),source_app:source.app??'',source_version:source.version??'',source_instance:source.instance??'',timestamp:m.timestamp??'',payload:raw,last_received:new Date().toISOString(),protocol_error:''})
    if(m.type==='event'&&m.expectsResponse===true)this.sendAck(m)
    if(this.config?.debug)this.log('debug',`RX VPP ${raw}`)
  }
}
runEntrypoint(VoicePrompterInstance, [])
