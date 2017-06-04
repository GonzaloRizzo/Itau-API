function b64decode(b64) {
  return new Buffer(b64, 'base64').toString('ascii');
}

module.exports = {
  b64decode,
};
