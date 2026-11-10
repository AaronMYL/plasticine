import type { ContactMessageView, NetworkAttachmentView } from '../shared.ts';
import type { FakeContacts } from './fake-contacts.ts';
import type { FakeNetworkAttachments } from './fake-network-attachments.ts';

function mapImage(): string {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 300;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return '';
  ctx.fillStyle = '#ecece5'; ctx.fillRect(0, 0, 480, 300);
  ctx.fillStyle = '#d5ded2'; ctx.fillRect(20, 20, 145, 100); ctx.fillRect(310, 175, 150, 105);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 23;
  ctx.beginPath(); ctx.moveTo(20, 230); ctx.lineTo(150, 190); ctx.lineTo(250, 95); ctx.lineTo(455, 70); ctx.stroke();
  ctx.strokeStyle = '#748f9b'; ctx.lineWidth = 6; ctx.stroke();
  ctx.font = '18px sans-serif'; ctx.fillStyle = '#394b50';
  for (const [label, x, y] of [['A', 60, 218], ['B', 237, 108], ['C', 410, 76]] as const) {
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); ctx.fillText(label, x - 5, y - 20);
  }
  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}
function pdf(): string {
  const stream = 'BT /F1 22 Tf 50 740 Td (Studio weekend plan) Tj 0 -40 Td /F1 12 Tf '
    + '(Saturday: review the draft and visit the workshop.) Tj 0 -24 Td '
    + '(Sunday: collect feedback and prepare the next issue.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let result = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(result.length); result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const start = result.length;
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) result += `${String(offset).padStart(10, '0')} 00000 n \n`;
  result += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return btoa(result);
}
export function seedNetworkAttachmentScene(contacts: FakeContacts, media: FakeNetworkAttachments, now: Date): void {
  const id = 'contact-media-fixture', groupId = 'grp-media-fixture';
  contacts.addPerson({ id, name: '小蕨', handle: 'fern-example', relation: 'friend' });
  const friend = contacts.face(id)!;
  contacts.groupChats.seed({ id: groupId, name: '工作室周末', avatar: null, members: [contacts.me, friend] });
  const image = mapImage(), plan = pdf();
  for (const thread of [id, groupId]) {
    const rows = [
      { author: 'them', text: '这是工作室附近的路线，周末见。', name: '工作室路线.png', type: 'image/png', data: image },
      { author: 'me', text: '周末安排也整理好了。', name: '周末安排.pdf', type: 'application/pdf', data: plan },
      { author: 'me', text: '', name: '材料清单.txt', type: 'text/plain',
        data: btoa('Paper, pencils and three notebooks.') },
    ] as const;
    rows.forEach((row, n) => {
      const messageId = `message-${thread}-${n}`;
      const attachment: NetworkAttachmentView = { id: `media-${thread}-${n}`, name: row.name, mimeType: row.type,
        bytes: atob(row.data).length, sha256: 'a'.repeat(64), status: 'ready', error: null,
        ...(row.type === 'image/png' ? { width: 480, height: 300, thumbnail: { mimeType: 'image/png' as const,
          width: 480, height: 300,
          content: row.data.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') } } : {}) };
      media.seed(attachment, row.data, thread, messageId);
      const message: ContactMessageView = { id: messageId, author: row.author, text: row.text,
        at: new Date(now.getTime() - (3 - n) * 60_000).toISOString(), status: n === 2 ? 'failed' : 'sent',
        error: n === 2 ? '连接中断，尚未送达。' : null, toAi: false, exchangeId: null, taskId: null,
        attachments: [attachment],
        ...(thread === groupId ? { sender: row.author === 'me' ? contacts.me : friend } : {}) };
      if (thread === groupId) contacts.groupChats.seedMessage(thread, message);
      else contacts.post(thread, message);
    });
  }
}
