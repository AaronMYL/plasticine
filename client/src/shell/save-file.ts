// 把已经拿到手的一个文件交给浏览器存下来（导出、读回来的附件原件）：桌面客户端里直接进「下载」文件夹。

/** 地址留一会儿再收：有的浏览器点了以后才去读它。 */
const REVOKE_AFTER_MS = 1000;

export function saveFile(file: { blob: Blob; name: string }): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
