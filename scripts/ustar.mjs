// Tiny dependency-free ustar packer for PaddleOCR.js model pairs.
function ustarEntry(name, bytes) {
  if (name.length > 100) throw new Error('TAR file name too long');
  const header = Buffer.alloc(512);
  header.write(name, 0, 'ascii');
  const oct = (n, off, len) => {
    const value = n.toString(8).padStart(len - 1, '0');
    header.write(`${value}\0`, off, 'ascii');
  };
  oct(0o644, 100, 8); // mode
  oct(0, 108, 8); // uid
  oct(0, 116, 8); // gid
  oct(bytes.length, 124, 12);
  oct(0, 136, 12); // deterministic timestamp
  header.fill(' ', 148, 156); // checksum placeholder
  header.write('0', 156, 'ascii'); // regular file
  header.write('ustar\0', 257, 'ascii');
  header.write('00', 263, 'ascii');
  const sum = header.reduce((acc, byte) => acc + byte, 0);
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  return Buffer.concat([header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512)]);
}
export function makeTar(onnx, yml) {
  return Buffer.concat([
    ustarEntry('inference.onnx', onnx),
    ustarEntry('inference.yml', yml),
    Buffer.alloc(1024),
  ]);
}
