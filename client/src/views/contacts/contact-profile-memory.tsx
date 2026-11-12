// 第 12 批：资料栏的「记忆」一节——这个联系人绑的是记忆里哪一页人物。
// 没绑、Plasticine 觉得像某一页时先问：「tingting 是记忆里的「贾婷婷」吗？」是的 / 不是 / 选别的…；一页都不像时只有
// 「关联人物…」。绑了：页名（点开到记忆里那一页）、最近几行（每行标谁说的），⋯ 里换一页或解绑。
// 绑了的人物页只在这台 Plasticine 里，不给对方和对方的 Plasticine 看（不管什么档位）。

import { useRef, useState, type ReactNode } from 'react';
import type { ContactMemory, ContactRow } from '../../api/shared.ts';
import { useLive } from '../../live.tsx';
import { DropdownMenu } from '../../shell/dropdown-menu.tsx';
import { Icon } from '../../shell/icons.tsx';
import { Popover, anchorOf, type PopoverAnchor } from '../../shell/popover.tsx';
import { routeHash } from '../../shell/routes.ts';
import type { PersonChoice } from './contact-edits.ts';

/** 资料栏里这一节的 id（列表「关联人物…」打开资料后落到这里）。 */
export function memorySectionId(contactId: string): string {
  return `contact-memory-${contactId}`;
}

/** 列表「关联人物…」：资料栏渲染出来以后落到「记忆」那一节（等几帧，资料可能还在读）。 */
export function focusMemory(contactId: string, tries = 20): void {
  requestAnimationFrame(() => {
    const section = document.getElementById(memorySectionId(contactId));
    if (section === null) {
      if (tries > 0) focusMemory(contactId, tries - 1);
      return;
    }
    section.scrollIntoView({ block: 'nearest' });
    section.focus({ preventScroll: true });
  });
}

function Picker({ contact, memory, anchor, onPick, onClose }: { contact: ContactRow; memory: ContactMemory;
  anchor: PopoverAnchor; onPick: (choice: PersonChoice) => void; onClose: () => void }): ReactNode {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = memory.people.filter((person) => needle === '' || person.title.toLowerCase().includes(needle));
  const fresh = query.trim() === '' ? contact.name : query.trim();
  const exists = memory.people.some((person) => person.title === fresh);
  return (
    <Popover anchor={anchor} role="dialog" align="start" label="选一页人物" onClose={onClose}>
      <div className="contact-person-picker">
        <input className="field-input" type="search" value={query} autoFocus placeholder="找人物页"
          aria-label="找人物页" onChange={(event) => setQuery(event.target.value)} />
        <ul className="contact-person-options" role="listbox" aria-label="人物页">
          {shown.map((person) => (
            <li key={person.id}>
              <button type="button" role="option" aria-selected={memory.doc?.id === person.id}
                className="popover-item" onClick={() => onPick({ docId: person.id })}>
                <span className="popover-item-label">{person.title}</span>
                {person.linked.length === 0 ? null
                  : <span className="contact-person-linked">已关联 {person.linked.join('、')}</span>}
              </button>
            </li>
          ))}
        </ul>
        {exists ? null : (
          <button type="button" className="popover-item" onClick={() => onPick({ create: fresh })}>
            <Icon name="plus" size={15} /><span className="popover-item-label">新建人物页「{fresh}」</span>
          </button>
        )}
      </div>
    </Popover>
  );
}

export function ContactMemorySection({ contact, memory }: { contact: ContactRow; memory: ContactMemory })
  : ReactNode {
  const { contactEdits } = useLive();
  const [picker, setPicker] = useState<PopoverAnchor | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const choose = (choice: PersonChoice): void => {
    setPicker(null);
    setProblem(null);
    void contactEdits.link(contact, choice).then(setProblem);
  };
  const openPicker = (button: HTMLElement): void => setPicker(anchorOf(button));
  const docLink = useRef<HTMLAnchorElement>(null);
  const doc = memory.doc;
  return (
    <section id={memorySectionId(contact.id)} className="profile-section contact-memory" aria-label="记忆"
      tabIndex={-1}>
      <div className="contact-memory-head">
        <p className="profile-label">记忆</p>
        {doc === null ? null : (
          <DropdownMenu label="人物页的更多操作" tip="更多" className="icon-button" align="end" items={[
            { label: '换一页…', icon: 'refresh', onSelect: () => {
              if (docLink.current !== null) openPicker(docLink.current);
            } },
            { label: '解除关联', icon: 'close', onSelect: () => choose({ docId: null }) },
          ]}>
            <Icon name="more" size={15} />
          </DropdownMenu>
        )}
      </div>
      {doc !== null ? (
        <>
          <a ref={docLink} className="contact-memory-doc"
            href={routeHash({ view: 'memory', noteId: null, topicId: doc.id })}>
            <Icon name="person" size={14} />{doc.title}
          </a>
          {memory.lines.length === 0 ? null : (
            <ul className="profile-list contact-memory-lines">
              {memory.lines.map((line) => (
                <li key={`${line.at}-${line.text}`}>
                  <span className="profile-item-text" title={line.text}>{line.text}</span>
                  <span className="profile-meta">{line.by}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : memory.suggest !== null ? (
        <div className="contact-memory-ask">
          <p>{contact.name} 是记忆里的「{memory.suggest.title}」吗？</p>
          <div className="contact-memory-answers">
            <button type="button" className="chip-button" onClick={() => choose({ docId: memory.suggest?.id ?? null })}>
              是的
            </button>
            <button type="button" className="chip-button" onClick={() => choose({ dismiss: true })}>不是</button>
            <button type="button" className="text-button" onClick={(event) => openPicker(event.currentTarget)}>
              选别的…
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="chip-button" onClick={(event) => openPicker(event.currentTarget)}>
          <Icon name="memory" size={14} />关联人物…
        </button>
      )}
      {problem === null ? null : <p className="contact-memory-error" role="alert">{problem}</p>}
      {picker === null ? null : (
        <Picker contact={contact} memory={memory} anchor={picker} onPick={choose} onClose={() => setPicker(null)} />
      )}
    </section>
  );
}
