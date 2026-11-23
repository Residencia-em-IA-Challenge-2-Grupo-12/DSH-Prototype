export const scenarios = {
  joined: {
    language: 'en',
    notes: [
      'Friday study felt too demanding last week. Mark Friday afternoon as something to reconsider for November 2 through November 8.',
      'To clarify, for November 2 through November 8 this is a soft preference: keep Friday afternoon free if possible. I aim for four study hours, and I have not agreed to a Friday fallback.',
    ],
    expected: [{ kind: 'unknown', fallbackMinutes: null }, { kind: 'soft', fallbackMinutes: null }],
  },
  skipped: { language: 'en', notes: [], expected: [] },
  conflicting: {
    language: 'en',
    notes: [
      'I cannot study on Friday afternoon at all during November 2 through November 8. Please keep it free.',
      'I can study on Friday afternoon after all, during November 2 through November 8. I would prefer to keep it free, but I agree to one hour on Friday if it gets me to four study hours.',
    ],
    expected: [{ kind: 'hard', fallbackMinutes: null }, { kind: 'soft', fallbackMinutes: 60 }],
  },
  portuguese: {
    language: 'pt',
    notes: [
      'O estudo da sexta passada me cansou. Quero repensar a sexta à tarde para a semana de 2 a 8 de novembro.',
      'Explicando melhor: de 2 a 8 de novembro, prefiro deixar a sexta à tarde livre se der. Minha meta é estudar quatro horas na semana, mas ainda não aceitei usar a sexta como alternativa.',
    ],
    expected: [{ kind: 'unknown', fallbackMinutes: null }, { kind: 'soft', fallbackMinutes: null }],
  },
};
