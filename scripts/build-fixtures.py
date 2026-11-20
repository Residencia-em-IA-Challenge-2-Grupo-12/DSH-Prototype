from datetime import date,timedelta
import json
from pathlib import Path
root=Path('fixtures')
def make(student):
    path=root/'calendars'/f'{student}.json'; data=json.loads(path.read_text()); data['events']=[]
    def event(id,day,start,end,summary,kind,description=''):
        data['events'].append({'id':id,'calendarId':student+'-calendar','summary':summary,'description':description,'start':{'dateTime':f'{day}T{start}:00-03:00','timeZone':'America/Sao_Paulo'},'end':{'dateTime':f'{day}T{end}:00-03:00','timeZone':'America/Sao_Paulo'},'extendedProperties':{'private':{'fixtureKind':kind}}})
    event(student+'-study-past','2026-10-30','10:00','11:00','Study: review' if student=='ana' else 'Estudo: revisão','study')
    first=date(2026,11,2)
    for week in range(6):
        for d in range(7):
            day=first+timedelta(days=week*7+d);stamp=day.isoformat();key=f'{week}-{d}'
            if student=='ana':
                if d<5:
                    event('ana-work' if week==0 and d==0 else 'ana-work-'+key,stamp,'08:00','12:00','Part-time work','work')
                    event('ana-lunch-'+key,stamp,'12:00','13:00','Lunch and transition','personal')
                if d in (0,2,3) and not (week==1 and d==2):
                    event('ana-commute-'+key,stamp,'17:30','18:30','Travel to campus','travel')
                    event('ana-class' if week==0 and d==0 else 'ana-class-'+key,stamp,'18:30','21:30','Evening class','class','Existing class: preserve this description.' if week==0 and d==0 else '')
                if d==3:event('ana-exercise' if week==0 else 'ana-exercise-'+str(week),stamp,'16:30','17:30','Physical activity','personal')
                if week==1 and d==2:event('ana-later',stamp,'14:00','15:00','Health appointment','personal')
                if d==6:event('ana-personal-'+str(week),stamp,'10:00','13:00','Family and personal time','personal')
            else:
                if d<5:
                    event('bruno-work' if week==0 and d==0 else 'bruno-work-am-'+key,stamp,'09:00','12:00','Trabalho','work')
                    event('bruno-lunch-'+key,stamp,'12:00','13:00','Almoço','personal')
                    event('bruno-work-pm-'+key,stamp,'13:00','18:00','Trabalho','work')
                    event('bruno-commute-'+key,stamp,'18:00','19:00','Deslocamento','travel')
                if d in (1,3):event('bruno-class' if week==0 and d==1 else 'bruno-class-'+key,stamp,'19:00','22:00','Aula noturna','class','Aula existente: preservar esta descrição.' if week==0 and d==1 else '')
                if d==5:event('bruno-saturday-class-'+str(week),stamp,'09:00','12:00','Aula de sábado','class')
                if d==4:event('bruno-exercise' if week==0 else 'bruno-exercise-'+str(week),stamp,'19:00','20:00','Atividade física','personal')
                if week==1 and d==2:event('bruno-later',stamp,'19:00','20:00','Compromisso familiar','personal')
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
for s in ('ana','bruno'):make(s)
for s,windows in {
 'ana':[(1,'14:00','16:15'),(3,'14:00','16:15'),(5,'14:00','16:15'),(6,'10:00','12:15')],
 'bruno':[(1,'19:00','21:15'),(3,'19:00','21:15'),(6,'14:00','16:15'),(0,'10:00','12:15')],
}.items():
 p=root/'students'/s/'courses.json'; data=json.loads(p.read_text());data['studyWindows']=[{'weekday':d,'start':start,'end':end} for d,start,end in windows];data['maxDailyStudyHours']=2;data['studyBreakMinutes']=15;p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
