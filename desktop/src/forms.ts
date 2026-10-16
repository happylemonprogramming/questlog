import type { WebContents, WebFrameMain } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Reading and filling the application form in the Apply pane. Each frame of
 * the page (career sites often embed the real form in an iframe) gets a small
 * script that lists the fields with their labels and tags each with a ref, so
 * the agent can say "set f0.3 to Yes". Values go in the way typing does, so
 * React and other frameworks notice. Nothing here ever submits the form.
 */

export interface Field {
  ref: string;
  kind: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'combobox';
  label: string;
  type?: string;
  required?: boolean;
  value?: unknown;
  options?: string[];
  accept?: string;
}

export interface Button {
  ref: string;
  text: string;
  submits: boolean;
}

/** Installed in each frame as window.__odx. Runs in the page, so it can only use the DOM. */
function pageLib() {
  const w = window as unknown as { __odx?: unknown };
  if (w.__odx) return;
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const text = (el: Element | null | undefined) => clean((el as HTMLElement | null)?.innerText ?? el?.textContent);
  const shown = (el: Element) => {
    const s = getComputedStyle(el);
    return el.getClientRects().length > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const SUBMIT = /\b(submit|send|apply|finish|finali[sz]e|complete|confirm)\b/i;
  /** Labels that only move between a form's steps. */
  const STEP = /^(next|continue|save (and|&) continue|proceed|back|previous|add( another)?|upload|attach|edit|remove|delete|cancel|close)\b/i;

  /**
   * Whether pressing a button could send the application: its label says so,
   * or it submits a form (a <button> in a form submits unless typed
   * otherwise) and isn't plainly a step button like "Next".
   */
  function submits(el: Element, label: string) {
    if (SUBMIT.test(label)) return true;
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    const formSubmit = (el.tagName === 'INPUT' && (type === 'submit' || type === 'image')) || (el.tagName === 'BUTTON' && (type === '' || type === 'submit') && !!(el as HTMLButtonElement).form);
    return formSubmit && !STEP.test(label);
  }

  /** Cancel any form submission in this frame for a moment, e.g. while pressing Enter in a field. */
  function holdSubmits(ms: number) {
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('submit', stop, true);
    setTimeout(() => window.removeEventListener('submit', stop, true), ms);
  }

  /** The question a field answers: its label, or the nearest label-like text above it. */
  function labelOf(el: Element, skipOwn = false): string {
    if (!skipOwn) {
      const aria = el.getAttribute('aria-label');
      if (aria) return clean(aria);
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const t = clean(by.split(/\s+/).map((id) => text(document.getElementById(id))).join(' '));
        if (t) return t;
      }
      if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (l && text(l)) return text(l);
      }
      const wrap = el.closest('label');
      if (wrap && text(wrap)) return text(wrap);
    }
    const fs = el.closest('fieldset')?.querySelector('legend');
    if (fs && text(fs)) return text(fs);
    let n: Element | null = el;
    for (let i = 0; i < 5 && n; i++) {
      n = n.parentElement;
      if (!n) break;
      const lab = [...n.querySelectorAll('label, legend, [class*="label" i], [class*="question" i], h3, h4')].find(
        (x) => !x.contains(el) && text(x) && !x.querySelector('input, select, textarea'),
      );
      if (lab) return text(lab);
    }
    return clean(el.getAttribute('placeholder') || el.getAttribute('name') || '');
  }

  const required = (el: Element) => (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(labelOf(el));

  let next = 0;
  const refOf = (el: Element, frame: number) => {
    let r = el.getAttribute('data-odx-ref');
    if (!r) {
      r = `f${frame}.${next++}`;
      el.setAttribute('data-odx-ref', r);
    }
    return r;
  };
  const byRef = (ref: string) => document.querySelector(`[data-odx-ref="${ref}"]`);

  function read(frame: number) {
    const fields: Record<string, unknown>[] = [];
    const groups = new Set<string>();
    const els = document.querySelectorAll('input, select, textarea, [contenteditable="true"], [role="combobox"]');
    for (const el of els) {
      const input = el as HTMLInputElement;
      const type = (input.type || '').toLowerCase();
      if (el.tagName === 'INPUT' && ['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) continue;
      if (type !== 'file' && !shown(el)) continue;
      // A combobox's inner text box is the combobox itself.
      if (el.tagName === 'INPUT' && el.closest('[role="combobox"]') && el.closest('[role="combobox"]') !== el) continue;
      if (type === 'radio' || (type === 'checkbox' && input.name && document.querySelectorAll(`input[type=checkbox][name="${CSS.escape(input.name)}"]`).length > 1)) {
        const key = `${type}:${input.name}`;
        if (groups.has(key)) continue;
        groups.add(key);
        const all = [...document.querySelectorAll<HTMLInputElement>(`input[type=${type}][name="${CSS.escape(input.name)}"]`)];
        all.forEach((r) => r.setAttribute('data-odx-ref', refOf(el, frame)));
        fields.push({
          ref: refOf(el, frame),
          kind: type === 'radio' ? 'radio' : 'checkbox',
          label: labelOf(el, true),
          required: all.some(required),
          options: all.map((r) => labelOf(r)),
          value: type === 'radio' ? all.filter((r) => r.checked).map((r) => labelOf(r))[0] ?? '' : all.filter((r) => r.checked).map((r) => labelOf(r)),
          multiple: type === 'checkbox',
        });
        continue;
      }
      // An upload's own label is often just its button ("Attach"); the question is above it.
      let label = labelOf(el);
      if (type === 'file' && /^(attach|upload|choose|browse|select|add)\b|^$/i.test(label)) label = labelOf(el, true) || label;
      const base = { ref: refOf(el, frame), label, required: required(el) || /\*\s*$/.test(label) };
      if (el.tagName === 'SELECT') {
        const s = el as HTMLSelectElement;
        fields.push({ ...base, kind: 'select', options: [...s.options].map((o) => clean(o.text)).filter(Boolean), value: s.selectedOptions[0]?.value === '' ? '' : clean(s.selectedOptions[0]?.text) });
      } else if (type === 'checkbox') {
        fields.push({ ...base, kind: 'checkbox', value: input.checked });
      } else if (type === 'file') {
        fields.push({ ...base, kind: 'file', accept: input.accept || undefined, value: [...(input.files ?? [])].map((f) => f.name) });
      } else if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')) {
        const box = el.closest('[class*="container" i], [class*="select" i]') ?? el.parentElement;
        fields.push({ ...base, kind: 'combobox', value: clean(input.value) || clean((box as HTMLElement | null)?.innerText) });
      } else if (el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable') === 'true') {
        fields.push({ ...base, kind: 'textarea', value: el.tagName === 'TEXTAREA' ? input.value : text(el) });
      } else {
        fields.push({ ...base, kind: 'text', type, value: input.value });
      }
    }
    const buttons = [...document.querySelectorAll('button, input[type=submit], [role=button], a[class*="button" i]')]
      .filter(shown)
      .slice(0, 50)
      .map((b) => {
        const label = clean((b as HTMLInputElement).value && b.tagName === 'INPUT' ? (b as HTMLInputElement).value : text(b) || b.getAttribute('aria-label'));
        return { ref: refOf(b, frame), text: label, submits: submits(b, label) };
      })
      .filter((b) => b.text);
    return { url: location.href, title: document.title, fields, buttons };
  }

  function setValue(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  const match = (options: string[], want: string) => {
    const w = clean(want).toLowerCase();
    return options.findIndex((o) => clean(o).toLowerCase() === w) >= 0
      ? options.findIndex((o) => clean(o).toLowerCase() === w)
      : options.findIndex((o) => clean(o).toLowerCase().startsWith(w) || (w.length > 2 && clean(o).toLowerCase().includes(w)));
  };

  /** Set one field. Comboboxes need real typing, which the app does from outside. */
  function fill(ref: string, value: unknown): { ok: boolean; note?: string; type?: boolean } {
    const el = byRef(ref) as HTMLInputElement | null;
    if (!el) return { ok: false, note: 'not on the page any more; read the form again' };
    el.scrollIntoView({ block: 'center' });
    const type = (el.type || '').toLowerCase();
    if (el.tagName === 'SELECT') {
      const s = el as unknown as HTMLSelectElement;
      const opts = [...s.options].map((o) => o.text);
      const i = match(opts, String(value));
      if (i < 0) return { ok: false, note: `no option "${value}"; options are ${opts.filter(Boolean).join(' | ')}` };
      s.selectedIndex = i;
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    if (type === 'radio' || (type === 'checkbox' && document.querySelectorAll(`[data-odx-ref="${ref}"]`).length > 1)) {
      const all = [...document.querySelectorAll<HTMLInputElement>(`[data-odx-ref="${ref}"]`)];
      const wants = (Array.isArray(value) ? value : [value]).map(String);
      for (const want of wants) {
        const i = match(all.map((r) => labelOf(r)), want);
        if (i < 0) return { ok: false, note: `no choice "${want}"; choices are ${all.map((r) => labelOf(r)).join(' | ')}` };
        if (!all[i].checked) all[i].click();
      }
      if (type === 'checkbox') for (const r of all) if (r.checked && match(wants, labelOf(r)) < 0) r.click();
      return { ok: true };
    }
    if (type === 'checkbox') {
      const want = value === true || /^(true|yes|y|checked|1)$/i.test(String(value));
      if (el.checked !== want) el.click();
      return { ok: true };
    }
    if (type === 'file') return { ok: false, note: 'a file upload; use attach_document' };
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')) {
      el.focus();
      if ('value' in el) setValue(el, '');
      return { ok: true, type: true };
    }
    if (el.getAttribute('contenteditable') === 'true') {
      el.focus();
      el.textContent = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    }
    el.focus();
    setValue(el, String(value ?? ''));
    return { ok: true };
  }

  /** After typing into a combobox: pick the matching option from the list that opened. */
  function pick(ref: string, want: string) {
    const opts = [...document.querySelectorAll('[role="option"], [class*="option" i]')].filter(shown) as HTMLElement[];
    const i = match(opts.map((o) => text(o)), want);
    if (i >= 0) {
      opts[i].scrollIntoView({ block: 'nearest' });
      opts[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      opts[i].click();
      return { ok: true, chose: text(opts[i]) };
    }
    return { ok: false, note: opts.length ? `no option like "${want}"; options shown: ${opts.slice(0, 15).map((o) => text(o)).join(' | ')}` : `no options appeared for "${want}"`, ref };
  }

  function click(ref: string) {
    const el = byRef(ref) as HTMLElement | null;
    if (!el) return { ok: false, note: 'not on the page any more; read the form again' };
    const label = clean((el as HTMLInputElement).value && el.tagName === 'INPUT' ? (el as HTMLInputElement).value : text(el) || el.getAttribute('aria-label'));
    if (submits(el, label)) return { ok: false, refused: true, note: `"${label}" would submit the application. Only the user submits.` };
    el.scrollIntoView({ block: 'center' });
    el.click();
    return { ok: true };
  }

  function attach(ref: string, b64: string, name: string) {
    const el = byRef(ref) as HTMLInputElement | null;
    if (!el) return { ok: false, note: 'not on the page any more; read the form again' };
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], name, { type: 'application/pdf' });
    const dt = new DataTransfer();
    dt.items.add(file);
    if (el.tagName === 'INPUT' && el.type === 'file') {
      el.files = dt.files;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    return { ok: true };
  }

  const pageText = () => clean(document.body?.innerText).slice(0, 12000);

  w.__odx = { read, fill, pick, click, attach, pageText, holdSubmits };
}

const LIB = `(${pageLib.toString()})();`;

export class Forms {
  private guest: WebContents | null = null;
  private frames: WebFrameMain[] = [];

  watch(guest: WebContents) {
    this.guest = guest;
    this.frames = [];
    guest.on('destroyed', () => {
      if (this.guest === guest) this.guest = null;
    });
  }

  status() {
    const g = this.live();
    return g ? { open: true, url: g.getURL(), loading: g.isLoading() } : { open: false };
  }

  private live() {
    return this.guest && !this.guest.isDestroyed() ? this.guest : null;
  }

  /** The form's page, once it has loaded. */
  private async page(): Promise<WebContents> {
    // The pane may have just been opened; give the page a moment to appear and load.
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const g = this.live();
      if (g && !g.isLoading() && g.getURL() !== 'about:blank') return g;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('No application form is open. Open one with open_application first.');
  }

  private async run<T>(frame: WebFrameMain, call: string): Promise<T> {
    return frame.executeJavaScript(`${LIB}; window.__odx.${call}`, true) as Promise<T>;
  }

  private frameOf(ref: string) {
    const f = this.frames[Number(ref.match(/^f(\d+)\./)?.[1] ?? -1)];
    if (!f || f.isDestroyed()) throw new Error(`Field ${ref} is gone. Read the form again.`);
    return f;
  }

  async read() {
    const g = await this.page();
    this.frames = g.mainFrame.framesInSubtree;
    const pages: { url: string; title: string; fields: Field[]; buttons: Button[] }[] = [];
    for (const [i, f] of this.frames.entries()) {
      try {
        const r = await this.run<(typeof pages)[number]>(f, `read(${i})`);
        if (r.fields.length || r.buttons.length || i === 0) pages.push(r);
      } catch {
        // Frames that are still loading or blank have nothing to fill.
      }
    }
    return { url: g.getURL(), title: g.getTitle(), fields: pages.flatMap((p) => p.fields), buttons: pages.flatMap((p) => p.buttons) };
  }

  async fill(fields: { ref: string; value: unknown }[]) {
    const g = await this.page();
    const out: { ref: string; ok: boolean; note?: string; chose?: string }[] = [];
    for (const { ref, value } of fields) {
      try {
        const f = this.frameOf(ref);
        const r = await this.run<{ ok: boolean; note?: string; type?: boolean }>(f, `fill(${JSON.stringify(ref)}, ${JSON.stringify(value)})`);
        if (r.type) {
          // Type like a person, so the list filters, then choose from it.
          g.focus();
          await g.insertText(String(value));
          await new Promise((res) => setTimeout(res, 700));
          let p = await this.run<{ ok: boolean; note?: string; chose?: string }>(f, `pick(${JSON.stringify(ref)}, ${JSON.stringify(String(value))})`);
          if (!p.ok) {
            // Some lists only take Enter, which in a plain text box would submit the form.
            await this.run(f, 'holdSubmits(1500)');
            g.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
            g.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
            p = { ...p, note: `${p.note}; pressed Enter instead, check it with read_form` };
          }
          out.push({ ref, ...p });
        } else out.push({ ref, ok: r.ok, note: r.note });
      } catch (e) {
        out.push({ ref, ok: false, note: (e as Error).message });
      }
    }
    return out;
  }

  async click(ref: string) {
    await this.page();
    const r = await this.run<{ ok: boolean; note?: string }>(this.frameOf(ref), `click(${JSON.stringify(ref)})`);
    // Let the page react (a new step, a modal) before the agent looks again.
    await new Promise((res) => setTimeout(res, 800));
    return r;
  }

  async attach(ref: string, file: string) {
    await this.page();
    const b64 = (await readFile(file)).toString('base64');
    const r = await this.run<{ ok: boolean; note?: string }>(this.frameOf(ref), `attach(${JSON.stringify(ref)}, ${JSON.stringify(b64)}, ${JSON.stringify(path.basename(file))})`);
    return { ...r, file: path.basename(file) };
  }

  async text() {
    const g = await this.page();
    const parts: string[] = [];
    for (const f of g.mainFrame.framesInSubtree) {
      try {
        const t = await this.run<string>(f, 'pageText()');
        if (t) parts.push(t);
      } catch {
        // skip
      }
    }
    return { url: g.getURL(), title: g.getTitle(), text: parts.join('\n\n---\n\n').slice(0, 16000) };
  }
}
