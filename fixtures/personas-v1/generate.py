#!/usr/bin/env python3
"""Generate fictional, bilingual study scenarios and Calendarpit fixtures."""
from datetime import date, datetime, timedelta
from pathlib import Path
import json

ROOT = Path(__file__).parent
START = date(2026, 11, 2)
TZ = 'America/Sao_Paulo'
LANGUAGES = ('en', 'pt-BR')
WEEKDAYS = list(range(5))
ALL_DAYS = list(range(7))

def slot(id, kind, days, start, end, en, pt, flexibility='fixed'):
    return {'id': id, 'kind': kind, 'days': days, 'start': start, 'end': end, 'label': {'en': en, 'pt-BR': pt}, 'flexibility': flexibility}

def shared():
    return [
        slot('sleep-early','sleep',ALL_DAYS,'00:00','07:00','Sleep','Sono','unspecified'),
        slot('morning','personal',ALL_DAYS,'07:00','08:00','Morning routine','Rotina da manhã','unspecified'),
        slot('wind-down','personal',ALL_DAYS,'22:00','23:00','Wind down','Desacelerar','unspecified'),
        slot('sleep-late','sleep',ALL_DAYS,'23:00','24:00','Sleep','Sono','unspecified'),
    ]

def window(id, days, start, end):
    return {'id': id, 'days': days, 'start': start, 'end': end}

PERSONAS = [
  {'id':'working-college', 'name':'Ana Silva', 'deadline':'2026-11-30T18:00:00-03:00', 'horizonWeeks':4, 'targetMinutes':360,
   'title':{'en':'Working college student','pt-BR':'Estudante universitária que trabalha'},
   'course':{'en':'Data analysis project','pt-BR':'Projeto de análise de dados'},
   'context':{'en':'Ana is an adult college student with a part-time job. She wants a manageable plan for a data analysis project while preserving time to rest and travel. She prefers short blocks and wants to review plans before any calendar changes.', 'pt-BR':'Ana é uma estudante universitária adulta com trabalho de meio período. Ela quer um plano viável para um projeto de análise de dados, preservando tempo para descanso e deslocamento. Prefere blocos curtos e quer revisar o plano antes de qualquer alteração na agenda.'},
   'deadlineNote':{'en':'Submit the project report and reproducible analysis by the deadline. Break the work into dataset review, analysis, draft and final checks.', 'pt-BR':'Entregar o relatório do projeto e a análise reproduzível até o prazo. Dividir o trabalho em revisão dos dados, análise, rascunho e conferência final.'},
   'slots':shared()+[
       slot('work-commute-out','commute',WEEKDAYS,'08:00','09:00','Travel to work','Deslocamento para o trabalho'),
       slot('work','work',WEEKDAYS,'09:00','13:00','Part-time work','Trabalho de meio período'),
       slot('work-commute-back','commute',WEEKDAYS,'13:00','14:00','Travel home','Volta para casa'),
       slot('lunch','meal',WEEKDAYS,'14:00','15:00','Lunch','Almoço','unspecified'),
       slot('early-dinner','meal',[0,1,3,4],'16:00','17:00','Early dinner','Jantar mais cedo','unspecified'),
       slot('other-dinner','meal',[2,5,6],'18:00','19:00','Dinner','Jantar','unspecified'),
       slot('class-commute-out','commute',[0,1,3,4],'17:00','18:00','Travel to class','Deslocamento para a aula'),
       slot('class','class',[0,1,3,4],'18:00','21:00','University class','Aula na universidade'),
       slot('class-commute-back','commute',[0,1,3,4],'21:00','22:00','Travel home','Volta para casa'),
       slot('weekend-lunch','meal',[5,6],'12:00','13:00','Lunch','Almoço','unspecified')],
   'windows':[window('wed-study',[2],'15:00','17:00'),window('wed-evening',[2],'19:00','20:30'),window('sat-study',[5],'09:00','11:00'),window('sun-study',[6],'10:00','12:00')],
   'exceptions':[{'id':'household','date':'2026-11-14','start':'14:00','end':'16:00','kind':'personal','label':{'en':'Household appointment','pt-BR':'Compromisso doméstico'},'flexibility':'unspecified','impactsStudyWindow':False}]},
  {'id':'nonworking-college', 'name':'Luísa Nunes', 'deadline':'2026-11-30T18:00:00-03:00', 'horizonWeeks':4, 'targetMinutes':420,
   'title':{'en':'Nonworking college student','pt-BR':'Estudante universitária sem trabalho remunerado'},
   'course':{'en':'Public health research essay','pt-BR':'Ensaio de pesquisa em saúde pública'},
   'context':{'en':'Luísa is an adult full-time university student with a substantial class schedule and a weekly family-care responsibility. She wants to make progress on a research essay without treating every free hour as study time.', 'pt-BR':'Luísa é uma estudante universitária adulta em período integral, com muitas aulas e uma responsabilidade semanal de cuidado familiar. Ela quer avançar em um ensaio de pesquisa sem tratar todas as horas livres como tempo de estudo.'},
   'deadlineNote':{'en':'Submit a research essay with a question, source notes, draft and final revision by the deadline.', 'pt-BR':'Entregar um ensaio de pesquisa com pergunta, notas de fontes, rascunho e revisão final até o prazo.'},
   'slots':shared()+[
       slot('class-commute-out','commute',[0,1,3,4],'08:00','09:00','Travel to campus','Deslocamento para o campus'),
       slot('class-am','class',[0,1,3,4],'09:00','12:00','University classes','Aulas na universidade'),
       slot('lunch','meal',[0,1,3,4],'12:00','13:00','Lunch','Almoço','unspecified'),
       slot('class-pm','class',[0,1,3,4],'14:00','17:00','University classes','Aulas na universidade'),
       slot('class-commute-back','commute',[0,1,3,4],'17:00','18:00','Travel home','Volta para casa'),
       slot('dinner','meal',WEEKDAYS,'18:00','19:00','Dinner','Jantar','unspecified'),
       slot('care','care',[2],'14:00','17:00','Family care','Cuidado familiar'),
       slot('groceries','personal',[5],'11:00','12:00','Groceries','Compras','unspecified'),
       slot('family-lunch','personal',[6],'12:00','14:00','Family lunch','Almoço em família','unspecified')],
   'windows':[window('evening',[0,1,3],'19:00','20:30'),window('wed-study',[2],'10:00','12:00'),window('sat-study',[5],'09:00','11:00')],
   'exceptions':[{'id':'appointment','date':'2026-11-11','start':'09:00','end':'10:00','kind':'personal','label':{'en':'Appointment','pt-BR':'Compromisso'},'flexibility':'fixed','impactsStudyWindow':False}]},
  {'id':'employed-exam', 'name':'Marcos Lima', 'deadline':'2026-12-14T18:00:00-03:00', 'horizonWeeks':6, 'targetMinutes':360,
   'title':{'en':'Employed exam candidate','pt-BR':'Pessoa trabalhadora se preparando para concurso'},
   'course':{'en':'Professional exam preparation','pt-BR':'Preparação para concurso profissional'},
   'context':{'en':'Marcos is an adult preparing for a professional exam while working full time. His work calendar includes the workday and its ordinary meal break. He wants to alternate review and practice questions and leave room for recovery.', 'pt-BR':'Marcos é uma pessoa adulta que se prepara para um concurso enquanto trabalha em período integral. A agenda registra a jornada de trabalho, incluindo o intervalo usual para refeição. Ele quer alternar revisão e questões práticas e manter espaço para recuperação.'},
   'deadlineNote':{'en':'Sit the professional exam on the deadline date. Alternate topic review, practice questions and a final review, adapting to available time.', 'pt-BR':'Fazer o concurso na data indicada. Alternar revisão de tópicos, questões práticas e revisão final, adaptando o plano ao tempo disponível.'},
   'slots':shared()+[
       slot('work-commute-out','commute',WEEKDAYS,'08:00','09:00','Travel to work','Deslocamento para o trabalho'),
       slot('work','work',WEEKDAYS,'09:00','17:00','Full-time workday','Jornada de trabalho integral'),
       slot('work-commute-back','commute',WEEKDAYS,'17:00','18:00','Travel home','Volta para casa'),
       slot('dinner','meal',WEEKDAYS,'18:00','19:00','Dinner','Jantar','unspecified'),
       slot('weekend-lunch','meal',[5,6],'12:00','13:00','Lunch','Almoço','unspecified'),
       slot('family','personal',[6],'15:00','18:00','Family time','Tempo com a família','unspecified')],
   'windows':[window('evening',[0,1,3],'19:00','20:30'),window('sat-study',[5],'10:00','12:00'),window('sun-study',[6],'10:00','12:00')],
   'exceptions':[{'id':'tuesday-conflict','date':'2026-11-10','start':'19:30','end':'20:30','kind':'personal','label':{'en':'Appointment','pt-BR':'Compromisso'},'flexibility':'fixed','impactsStudyWindow':True}]}
]

def jsonout(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def timestamp(day, time):
    if time == '24:00':
        day += timedelta(days=1)
        time = '00:00'
    return f'{day.isoformat()}T{time}:00-03:00'

def generate(persona, language):
    root = ROOT / 'generated' / persona['id'] / language
    records = []
    def event(id, label, kind, day, start, end, flex):
        return {'id': id, 'calendarId': 'calendar-'+persona['id'], 'summary':label,
                'start':{'dateTime':timestamp(day,start),'timeZone':TZ}, 'end':{'dateTime':timestamp(day,end),'timeZone':TZ},
                'extendedProperties':{'private':{'fixtureKind':kind,'flexibility':flex,'synthetic':'true'}}}
    for day_index in range(42):
        day = START + timedelta(days=day_index)
        for item in persona['slots']:
            if day.weekday() in item['days']:
                records.append(event(f"{item['id']}-{day.isoformat()}", item['label'][language],item['kind'],day,item['start'],item['end'],item['flexibility']))
        for item in persona['exceptions']:
            if item['date'] == day.isoformat():
                records.append(event(f"exception-{item['id']}", item['label'][language],item['kind'],day,item['start'],item['end'],item['flexibility']))
    fixture={'users':[{'id':persona['id'],'name':persona['name'],'email':persona['id']+'@example.test'}],
             'calendars':[{'id':'calendar-'+persona['id'],'userId':persona['id'],'summary':persona['title'][language],'timeZone':TZ,'primary':True}],
             'events':records,'clients':[]}
    localized = {'schemaVersion':1,'generatorVersion':'1','id':persona['id'],'language':language,'name':persona['name'],
       'simulationStart':START.isoformat(),'timeZone':TZ,'horizonWeeks':persona['horizonWeeks'],'deadline':persona['deadline'],
       'course':persona['course'][language], 'context':persona['context'][language], 'targetMinutesPerWeek':persona['targetMinutes'],
       'weeklyCommitments':[{**{k:v for k,v in x.items() if k!='label'},'label':x['label'][language]} for x in persona['slots']],
       'studyWindows':persona['windows'], 'exceptions':[{**{k:v for k,v in x.items() if k!='label'},'label':x['label'][language]} for x in persona['exceptions']]}
    jsonout(root/'scenario.json',localized)
    jsonout(root/'calendar.json',fixture)
    (root/'workspace'/'courses').mkdir(parents=True,exist_ok=True)
    (root/'workspace'/'context').mkdir(parents=True,exist_ok=True)
    title = 'Synthetic course outline' if language=='en' else 'Programa sintético'
    date_label = 'Deadline' if language=='en' else 'Prazo'
    (root/'workspace'/'courses'/'syllabus.md').write_text(f"# {title}: {persona['course'][language]}\n\n{date_label}: {persona['deadline']}\n\n{persona['deadlineNote'][language]}\n",encoding='utf-8')
    header = 'Fictional student context' if language=='en' else 'Contexto fictício da pessoa estudante'
    note = 'Study windows are possibilities, not bookings. Check actual commitments and ask before creating events.' if language=='en' else 'As janelas de estudo são possibilidades, não reservas. Confira os compromissos e pergunte antes de criar eventos.'
    (root/'workspace'/'context'/'preferences.md').write_text(f"# {header}\n\n{persona['context'][language]}\n\n{note}\n",encoding='utf-8')

def main():
    for persona in PERSONAS:
        for language in LANGUAGES:
            generate(persona, language)

if __name__ == '__main__':
    main()
