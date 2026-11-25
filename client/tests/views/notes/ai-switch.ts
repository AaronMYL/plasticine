import { fireEvent, screen } from '@testing-library/react';

type AiSwitch = '续写' | '补充建议';

function control(name: AiSwitch): HTMLInputElement {
  return screen.getAllByRole('switch')
    .find((element) => element.closest('label')?.textContent?.startsWith(name)) as HTMLInputElement;
}

export function toggleAi(name: AiSwitch): void {
  fireEvent.click(control(name));
}

export function aiOn(name: AiSwitch): boolean {
  return control(name).checked;
}
