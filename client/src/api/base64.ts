/** 一段字节写成 base64（上传文件、导入）。分片转：一次把 20 MB 的数组展开成参数会爆调用栈。 */
export async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const SLICE = 0x8000;
  for (let at = 0; at < bytes.length; at += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(at, at + SLICE));
  }
  return btoa(binary);
}
