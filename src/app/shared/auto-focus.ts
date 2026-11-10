import { Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** Foca (e seleciona o texto de) um input assim que ele aparece na tela. */
@Directive({ selector: 'input[appAutoFocus]' })
export class AutoFocus {
  constructor() {
    const el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      el.focus();
      el.select();
    });
  }
}
