import { useState, type ReactNode } from 'react';
import { PASSWORD_MAX_CHARS } from '../../api/shared.ts';
import { IconButton } from '../../shell/icon-button.tsx';
import { Icon } from '../../shell/icons.tsx';
import { PlasticineMark } from '../../shell/plasticine-mark.tsx';
import { hostShowWelcome } from '../../shell/host.ts';
import './onboard.css';

export function Brand(): ReactNode {
  return <div className="ob-brand"><PlasticineMark size={26} /><span>Plasticine</span></div>;
}

export interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'new-password' | 'current-password';
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

export function PasswordField({ id, label, value, onChange, autoComplete, disabled = false, autoFocus = false,
  invalid = false, describedBy }: PasswordFieldProps): ReactNode {
  const [shown, setShown] = useState(false);
  return (
    <div className="ob-field">
      <label className="ob-label" htmlFor={id}>{label}</label>
      <div className="ob-input" data-invalid={invalid}>
        <input id={id} type={shown ? 'text' : 'password'} value={value} autoComplete={autoComplete}
          maxLength={PASSWORD_MAX_CHARS} disabled={disabled} autoFocus={autoFocus} spellCheck={false}
          aria-invalid={invalid || undefined} aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)} />
        <IconButton icon="eye" label={shown ? '隐藏密码' : '显示密码'} aria-pressed={shown}
          onClick={() => setShown((value) => !value)} />
      </div>
    </div>
  );
}

export function ChangePlace(): ReactNode {
  const show = hostShowWelcome();
  if (show === null) {
    return null;
  }
  return (
    <button type="button" className="ob-link" onClick={show}>
      <Icon name="back" size={14} />换一个地方
    </button>
  );
}

export function suggestedDeviceName(agent: string = navigator.userAgent): string {
  if (/PlasticineDesktop\//.test(agent) || /Electron\//.test(agent)) {
    return /Windows/i.test(agent) ? 'Windows 电脑' : 'Mac';
  }
  if (/iPhone/i.test(agent)) return 'iPhone';
  if (/iPad/i.test(agent)) return 'iPad';
  if (/Android/i.test(agent)) return '安卓手机';
  if (/Macintosh/i.test(agent)) return 'Mac 上的浏览器';
  if (/Windows/i.test(agent)) return 'Windows 上的浏览器';
  return '浏览器';
}
