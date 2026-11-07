#!/usr/bin/env python3
"""Create synthetic, unreviewed bilingual retrieval fixtures; no real evidence."""
import json
from pathlib import Path

# Each row is an aligned source (not a translation-quality judgment).
# PDF references are invented; only the extracted text below exists.
DOCS = [
('syllabus-new','course/syllabus.pdf',3,'2026-11-02','Final statistics exam: 14 December 2026. The preceding review is on 10 December.','Prova final de estatística: 14 de dezembro de 2026. A revisão anterior ocorre em 10 de dezembro.'),
('syllabus-old','course/old-syllabus.pdf',2,'2026-10-05','Final statistics exam: 7 December 2026. This syllabus is an older course version.','Prova final de estatística: 7 de dezembro de 2026. Este plano de curso é uma versão antiga.'),
('ana-old-hours','notes/ana-context.md',None,'2026-11-02','Ana initially planned six hours of independent study per week.','Ana inicialmente planejou seis horas de estudo individual por semana.'),
('ana-new-hours','notes/ana-checkin.md',None,'2026-11-09','At her latest check-in, Ana reduced her available independent study time to four hours per week.','Na atualização mais recente, Ana reduziu o tempo disponível para estudo individual para quatro horas por semana.'),
('bruno-hours','notes/bruno-context.md',None,'2026-11-09','Bruno, a different student, has six hours available for weekly study.','Bruno, outro estudante, tem seis horas disponíveis para estudo semanal.'),
('ana-work','calendar/events.json',None,'2026-11-02','Ana works Monday through Friday from 09:00 to 13:00.','Ana trabalha de segunda a sexta-feira das 09:00 às 13:00.'),
('class','calendar/events.json',None,'2026-11-02','Ana has a statistics lecture on Monday from 18:00 to 20:00.','Ana tem aula de estatística na segunda-feira das 18:00 às 20:00.'),
('window','notes/preferences.md',None,'2026-11-02','Ana can study on Monday from 20:00 to 22:00, after class.','Ana pode estudar na segunda-feira das 20:00 às 22:00, depois da aula.'),
('break','notes/preferences.md',None,'2026-11-02','Ana prefers a 15-minute pause between study blocks when possible.','Ana prefere uma pausa de 15 minutos entre blocos de estudo quando possível.'),
('travel','notes/travel.md',None,'2026-11-02','The trip from Ana’s workplace to campus takes 45 minutes.','O trajeto do trabalho de Ana até o campus leva 45 minutos.'),
('feedback','feedback/checkins.json',None,'2026-11-09','For the previous week Ana provided no completion feedback for her study sessions; whether she completed them is unknown.','Na semana anterior, Ana não enviou informações sobre a conclusão das sessões de estudo; não se sabe se ela as concluiu.'),
('event-flex','notes/preferences.md',None,'2026-11-02','Ana says the Friday leisure event can be moved if she explicitly approves the change.','Ana diz que o evento de lazer de sexta-feira pode ser remarcado se ela aprovar explicitamente a alteração.'),
('exam-outline','exam-prep/outline.pdf',4,'2026-11-02','Bruno is preparing for a public-service entrance exam, with a target date six weeks from 2 November.','Bruno está se preparando para um concurso público, com data-alvo seis semanas após 2 de novembro.'),
('exercise','notes/preferences.md',None,'2026-11-02','Ana values a walk outside on Saturday, but has not chosen a time.','Ana valoriza caminhar ao ar livre no sábado, mas ainda não escolheu um horário.'),
('mock-guide','guides/example-adult.pdf',5,'2026-10-01','FICTIONAL TEST GUIDE: For an adult learner, a short recall exercise is one possible review activity.','GUIA FICTÍCIO DE TESTE: Para um estudante adulto, um breve exercício de recordação é uma possível atividade de revisão.'),
('mock-minor','guides/example-minor.pdf',2,'2026-10-01','FICTIONAL TEST GUIDE: A minor’s sample schedule includes an adult supervisor.','GUIA FICTÍCIO DE TESTE: Um exemplo de rotina para menores inclui a supervisão de um adulto.'),
('food','notes/preferences.md',None,'2026-11-02','Ana reserves a lunch break on weekdays between 13:00 and 14:00.','Ana reserva uma pausa para almoço nos dias úteis entre 13:00 e 14:00.'),
('deadline-extra','course/assignment.txt',None,'2026-11-02','The statistics project is due on 20 November; the final exam is a different deadline.','O projeto de estatística deve ser entregue em 20 de novembro; a prova final tem outro prazo.'),
]
# Relevant IDs, misleading IDs, an evidence/status expectation, and paired queries.
QUERIES = [
('exact-deadline','exact',['syllabus-new'],['deadline-extra'], 'supported','What is the final statistics exam date in the current syllabus?','Qual é a data da prova final de estatística no plano atual?'),
('paraphrase-work','paraphrase',['ana-work'],['bruno-hours'], 'supported','When is Ana unavailable because of her job on weekdays?','Em que horário Ana não está disponível por causa do emprego nos dias úteis?'),
('paraphrase-travel','paraphrase',['travel'],['ana-work'], 'supported','How long does Ana need to get from work to campus?','Quanto tempo Ana precisa para ir do trabalho ao campus?'),
('latest-hours','temporal',['ana-new-hours'],['ana-old-hours','bruno-hours'], 'supported','What is Ana’s latest stated weekly study capacity?','Qual é a capacidade semanal de estudo informada mais recentemente por Ana?'),
('hours-conflict','conflict',['ana-old-hours','ana-new-hours'],['bruno-hours'], 'goal-vs-capacity','How does Ana’s earlier weekly study goal compare with her latest stated capacity?','Como a meta semanal de estudo anterior de Ana se compara à capacidade informada mais recentemente?'),
('latest-deadline','temporal',['syllabus-new'],['syllabus-old','deadline-extra'], 'superseded','Use the newest syllabus: when is the final exam?','Usando o plano de curso mais recente, quando é a prova final?'),
('deadline-conflict','conflict',['syllabus-new','syllabus-old'],['deadline-extra'], 'changed-over-time','What differing final exam dates appear across syllabus versions?','Quais datas diferentes da prova final aparecem nas versões do plano de curso?'),
('separate-person','inapplicable',['bruno-hours'],['ana-old-hours','ana-new-hours'], 'supported','How much weekly study time did Bruno report?','Quanto tempo semanal de estudo Bruno informou?'),
('student-break','paraphrase',['break'],['food'], 'supported','What interval does Ana prefer between sessions?','Qual intervalo Ana prefere entre as sessões?'),
('missing-feedback','missing',['feedback'],['ana-new-hours'], 'unknown-with-evidence','Did Ana finish her scheduled study sessions last week?','Ana concluiu as sessões de estudo programadas para a semana passada?'),
('event-permission','exact',['event-flex'],['exercise'], 'conditional','May the Friday leisure event be moved automatically?','O evento de lazer de sexta pode ser remarcado automaticamente?'),
('academic-horizon','paraphrase',['exam-outline'],['syllabus-new','deadline-extra'], 'supported','How far away is Bruno’s public-service exam target from the simulated start?','Quanto tempo falta para a data-alvo do concurso público de Bruno desde o início simulado?'),
('adult-applicability','inapplicable',['mock-guide'],['mock-minor'], 'fictional-only','Which fictional sample guidance describes an adult learner’s review?','Qual orientação fictícia de exemplo descreve a revisão de um estudante adulto?'),
('desired-activity','paraphrase',['exercise'],['event-flex'], 'partial-unknown-with-evidence','What outdoor activity matters to Ana, and what is known about its time?','Que atividade ao ar livre importa para Ana e o que se sabe sobre o horário dela?'),
('two-contexts','multihop',['class','window'],['ana-work'], 'supported','What class comes immediately before Ana’s Monday study window?','Que aula ocorre imediatamente antes da janela de estudo de Ana na segunda-feira?'),
('no-caffeine','no-answer',[],['food','break'], 'no-source','What is Ana’s caffeine tolerance?','Qual é a tolerância de Ana à cafeína?'),
('no-financial','no-answer',[],['ana-work','exam-outline'], 'no-source','What scholarship amount does Bruno receive?','Qual é o valor da bolsa que Bruno recebe?'),
('specific-deadline','exact',['deadline-extra'],['syllabus-new'], 'supported','What is the due date of the statistics project?','Qual é o prazo de entrega do projeto de estatística?'),
]

def build():
    passages=[]
    queries=[]
    for code,path,page,updated,en,pt in DOCS:
        for lang,text in [('en',en),('pt-BR',pt)]:
            passages.append({'id':f'{code}:{lang}','concept':code,'language':lang,'text':text,
                 'source':{'path':'synthetic/'+path,'kind':'simulated_pdf_extraction' if page else 'synthetic_text','page':page,'updated':updated}})
    for code,kind,relevant,hard,status,en,pt in QUERIES:
        for lang,text in [('en',en),('pt-BR',pt)]:
            queries.append({'id':f'{code}:{lang}','concept':code,'language':lang,'type':kind,'text':text,'as_of':'2026-11-09',
                 'relevant_ids':[f'{item}:{lang}' for item in relevant], 'hard_negative_ids':[f'{item}:{lang}' for item in hard], 'expected_evidence_state':status})
    return {'schema_version':1,'status':'synthetic-unreviewed-not-real-evidence',
        'notes':['Invented text and records; do not use as a wellbeing or academic guidance source.',
                 'PDF names and page numbers simulate extracted text; no corresponding PDFs are supplied.',
                 'All queries are evaluated as of 2026-11-09; scenario start references remain 2026-11-02. Surface source dates to the answering system.',
                 'Bilingual cases are aligned by concept; labels and translations need independent human review.'],
        'passages':passages,'queries':queries}
if __name__=='__main__':
    target=Path(__file__).with_name('heldout.json')
    target.write_text(json.dumps(build(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(target)
