# Fictional bilingual study scenarios

These files describe three invented adult personas. Names, course materials, events and `.test` accounts are synthetic. Generated data is version 1 with a fixed simulation date of 2026-11-02 and the `America/Sao_Paulo` timezone. Run `python3 generate.py` to regenerate all fixtures and `python3 test_personas.py` for validation; no extra Python packages are required.

| Persona | Weekly work | Weekly class | Study goal | Nominal study windows | Deadline |
|---|---:|---:|---:|---:|---|
| Working college student | 20 h | 12 h | 6 h | 7.5 h | 2026-11-30 |
| Nonworking college student | 0 h | 24 h | 7 h | 8.5 h | 2026-11-30 |
| Employed exam candidate | 40 h | 0 h | 6 h | 8.5 h | 2026-12-14 |

Workday time is calendar time; the employed candidate's workday includes an ordinary meal break. Commutes, meals, sleep, routine and personal/family commitments are explicitly present. A one-off appointment intersects the exam candidate's Tuesday window on 2026-11-10; a window expresses a possibility, not availability guaranteed in the presence of calendar events. Other one-off commitments add context. Work/classes/commutes are fixture commitments; personal blocks marked `unspecified` should not silently be treated as freely movable or permanently fixed.

Each persona has parallel `en` and `pt-BR` folders. `scenario.json` holds the shared structured facts and localized text; `calendar.json` contains 42 days of explicit Calendarpit seed events; `workspace/courses/syllabus.md` and `workspace/context/preferences.md` provide selected fictional documents. Equivalent versions use identical IDs, timing and structured facts. No user approval or model decision is synthesized by these fixtures.

`test_personas.py` checks EN/PT structural parity, source links and deadlines, unique IDs and time bounds, all six weeks for event overlaps, weekly study-window conflicts and exception annotations, net capacity after exceptions, work/class/sleep totals and four/six-week deadlines. It does not judge whether any proposed schedule is helpful, verify every localized phrase, or run Calendarpit. These are a new scenario contract: the existing prototype only recognizes `ana` and `bruno`, so an adapter or expanded selection is needed before these new persona IDs can be used there. PDF course material and the separate nonacademic activity scenarios still need authoring.
