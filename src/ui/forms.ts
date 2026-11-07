import { element, field, input } from './dom.ts';

export function actionForm(options: {
  title: string;
  fields: { label: string; name: string; type?: string; required?: boolean }[];
  submit: (form: HTMLFormElement) => Promise<void>;
  report: (code: string) => void;
}): HTMLFormElement {
  const form = element('form');
  for (const definition of options.fields) form.append(input(definition));
  const button = element('button', { type: 'submit' }, options.title);
  form.append(button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    void options
      .submit(form)
      .then(() => {
        options.report('Done.');
      })
      .catch((error: unknown) => {
        options.report(errorCode(error));
      })
      .finally(() => {
        for (const node of form.querySelectorAll<HTMLInputElement>('input[type="password"]'))
          node.value = '';
        button.disabled = false;
      });
  });
  return form;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    if (/^[a-z-]{1,64}$/.test(error.code)) return `Operation failed: ${error.code}.`;
  }
  return 'The operation failed. Your last saved wallet remains available.';
}

export function value(form: HTMLFormElement, name: string): string {
  return field(form, name).value;
}
