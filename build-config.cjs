module.exports = {
  // SUM loads these application profiles from disk. Keep the directory intact
  // so the packaged entrypoint can read ./manifests/*.json as it does in dev.
  extraFiles: ['manifests'],
}
