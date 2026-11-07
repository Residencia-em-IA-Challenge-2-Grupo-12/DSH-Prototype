// DSH's browser module format, matching its pinned client plugin loader.
// Deliberately static synthetic data: the shared domain service does not yet exist.
window.__ModuleLoader__.load({
  id: 'dsh-study-calendar-spike',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const id = 'dsh-study-calendar-spike';
    const isPt = () => globalThis.navigator?.language?.toLowerCase().startsWith('pt');
    const label = (en, pt) => isPt() ? pt : en;
    const data = [
      { day: 0, start: 9, end: 12, type: 'existing', en: 'Work', pt: 'Trabalho' },
      { day: 0, start: 18, end: 20, type: 'existing', en: 'Class', pt: 'Aula' },
      { day: 1, start: 10, end: 11, type: 'add', en: 'Review', pt: 'Revisão' },
      { day: 3, start: 18, end: 19.5, type: 'add', en: 'Practice', pt: 'Prática' },
      { day: 5, start: 10, end: 11, type: 'remove', en: 'Previous study block', pt: 'Bloco anterior' },
    ];
    const bg = { existing: '#cce8da', add: '#dceaff', remove: '#ffe6df' };
    const time = value => `${Math.floor(value)}:${value % 1 ? '30' : '00'}`;
    function Calendar() {
      const days = label(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
      return h('section', { style: { padding: 16, fontFamily: 'sans-serif', color: '#17352c' } },
        h('h2', null, label('Study calendar — interface spike', 'Calendário de estudos — protótipo')),
        h('p', { role: 'status' }, label('Illustrative synthetic data only. This panel is not connected to the calendar or approvals.', 'Somente dados sintéticos ilustrativos. Este painel não está conectado ao calendário ou às aprovações.')),
        h('p', null, label('2–8 November 2026 · São Paulo', '2–8 de novembro de 2026 · São Paulo')),
        h('p', null, label('Green: existing · Blue: proposed addition · Red: proposed removal', 'Verde: existente · Azul: adição proposta · Vermelho: remoção proposta')),
        h('div', { style: { overflowX: 'auto' } },
          h('div', { style: { display: 'grid', gridTemplateColumns: '38px repeat(7, 86px)', minWidth: 640 } },
            h('div', null), ...days.map((day, i) => h('strong', { key: day, style: { padding: 4 } }, `${day} ${2 + i}`)),
            h('div', { style: { height: 560, position: 'relative' } }, ...[8, 10, 12, 14, 16, 18, 20, 22].map(hour => h('span', { key: hour, style: { position: 'absolute', top: `${(hour - 8) * 40}px`, fontSize: 10 } }, `${hour}:00`))),
            ...days.map((day, dayIndex) => h('div', { key: day, style: { height: 560, position: 'relative', borderLeft: '1px solid #dce4dc', background: 'repeating-linear-gradient(to bottom, transparent 0px, transparent 39px, #edf0ed 40px)' } },
              ...data.filter(event => event.day === dayIndex).map(event => h('div', { key: event.en,
                title: `${label(event.en, event.pt)} ${time(event.start)}–${time(event.end)}`,
                style: { position: 'absolute', left: 2, right: 2, top: `${(event.start - 8) * 40}px`, height: `${(event.end - event.start) * 40}px`, boxSizing: 'border-box', overflow: 'hidden', background: bg[event.type], border: '1px solid #91aa9d', borderRadius: 4, padding: 3, fontSize: 10 } }, label(event.en, event.pt))))))),
        h('h3', null, label('Illustrative proposal difference', 'Exemplo de diferença da proposta')),
        h('ul', null, h('li', null, label('Add Review and Practice', 'Adicionar Revisão e Prática')), h('li', null, label('Remove Previous study block', 'Remover Bloco anterior'))),
        h('p', null, label('Review and calendar writes are unavailable in this spike.', 'Revisão e alterações no calendário não estão disponíveis neste protótipo.')));
    }
    function apply(ctx) {
      ctx.effect(() => ctx.sidebarRightTabs.register({
        id, kind: 'study-calendar-spike', title: () => label('Study calendar', 'Calendário de estudos'),
        guide: [{ id: 'open', title: () => label('Study calendar', 'Calendário de estudos'), description: () => label('Illustrative calendar interface spike', 'Protótipo ilustrativo de calendário') }],
      }), 'study-calendar: tab');
      ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Calendar));
    }
    return { apply, inject: ['slots', 'sidebarRightTabs'] };
  },
});
