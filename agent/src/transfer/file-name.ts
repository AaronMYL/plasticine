// 导出时的文件名：标题里文件系统不认的字换成空格，结尾的点和空格去掉，Windows 的保留名前面加下划线，太长的截短；
// 同一个目录里重名的往后排号（「计划 2.md」）。

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]+/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** 文件名（不含扩展名）最多这么多字：留出目录和排号的余地，常见文件系统一段最多 255 字节。 */
const NAME_MAX_CHARS = 80;

/** 一段能当文件名用的字；什么都不剩就用 fallback。 */
export function safeFileName(title: string, fallback: string): string {
  const cleaned = title.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').replace(/[. ]+$/, '').replace(/^[. ]+/, '');
  const clipped = Array.from(cleaned).slice(0, NAME_MAX_CHARS).join('').trim();
  if (clipped === '') {
    return fallback;
  }
  return RESERVED.test(clipped) ? `_${clipped}` : clipped;
}

/**
 * 给一批文件起不重名的路径：directory 是 zip 里的目录（没有就是空串），返回「目录/名字.扩展名」。
 * 大小写不同也算重名（Windows、Mac 默认不分大小写）。
 */
export function createNamer(): (directory: string, base: string, extension: string) => string {
  const used = new Set<string>();
  return (directory, base, extension) => {
    const prefix = directory === '' ? '' : `${directory}/`;
    for (let index = 1; ; index += 1) {
      const path = `${prefix}${index === 1 ? base : `${base} ${index}`}.${extension}`;
      const key = path.toLowerCase();
      if (!used.has(key)) {
        used.add(key);
        return path;
      }
    }
  };
}
