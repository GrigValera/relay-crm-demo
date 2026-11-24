export const storageKey = 'creator-relay-v1'
export const teams = ['Продажи', 'Поддержка']
export const samples = [
  { name: 'Лида Романова', source: 'Форма сайта', subject: 'Заявки с нового лендинга', body: 'Запускаем страницу для курсов английского. Хотим, чтобы после заполнения формы заявка вместе с выбранным курсом появлялась в CRM. Можно оценить подключение?' },
  { name: 'Илья Лавров', source: 'Чат-бот', subject: 'Не приходит подтверждение записи', body: 'Вчера выбрал время занятия, но подтверждение не пришло. В личном кабинете запись видна. Подскажите, как проверить, что время за мной.' },
  { name: 'Алла Морозова', source: 'Электронная почта', subject: 'Расчёт разработки интернет-магазина', body: 'Нужна витрина для небольшой мастерской. В каталоге будет около 40 товаров. Хотим принимать заказы с самовывозом и оплатой при получении. С чего начать?' },
]

function eventFor(lead, text, at) {
  return { lead: lead.id, name: lead.name, text, at }
}

function makeLead(id, sample, queue, at) {
  return { ...sample, id, queue, receivedAt: at, status: 'new', crmId: null }
}

export function initialState(now = Date.now()) {
  const rules = Object.fromEntries(samples.map((sample, index) => [sample.source, teams[index % teams.length]]))
  const leads = samples.slice(0, 2).map((sample, index) => makeLead(index + 1, sample, rules[sample.source], now - index * 28 * 60000))
  return { next: 3, leads, rules, events: leads.map(lead => eventFor(lead, 'Получено · ' + lead.source, lead.receivedAt)) }
}

function crmNumber(leadId) {
  return 'CRM-' + String(leadId).padStart(4, '0')
}

export function restoreState(saved, now = Date.now()) {
  if (!Array.isArray(saved?.leads) || !Array.isArray(saved.events) || !saved.rules || !Number.isSafeInteger(saved.next)) return initialState(now)
  const base = initialState(now)
  const leads = saved.leads.filter(lead => Number.isSafeInteger(lead?.id) && typeof lead.subject === 'string' && typeof lead.name === 'string').map(lead => {
    const sample = samples.find(item => item.source === lead.source)
    const status = ['new', 'sent', 'failed'].includes(lead.status) ? lead.status : lead.done ? 'sent' : 'new'
    return {
      ...lead,
      body: lead.body || sample?.body || 'Текст этого обращения недоступен.',
      queue: teams.includes(lead.queue) ? lead.queue : base.rules[lead.source] || teams[0],
      receivedAt: Number.isFinite(lead.receivedAt) ? lead.receivedAt : null,
      status,
      crmId: status === 'sent' ? lead.crmId || crmNumber(lead.id) : null,
    }
  })
  const rules = Object.fromEntries(samples.map(({ source }) => [source, teams.includes(saved.rules[source]) ? saved.rules[source] : base.rules[source]]))
  return { next: Math.max(1, saved.next, ...leads.map(lead => lead.id + 1)), leads, rules, events: saved.events.filter(event => Number.isSafeInteger(event?.lead) && Number.isFinite(event.at) && typeof event.text === 'string') }
}

export function receive(state, source, at = Date.now()) {
  const sample = samples.find(item => item.source === source)
  if (!sample) return state
  const lead = makeLead(state.next, sample, state.rules[source], at)
  return { ...state, next: state.next + 1, leads: [lead, ...state.leads], events: [eventFor(lead, 'Получено · ' + lead.source, at), ...state.events] }
}

export function transfer(state, id, fail, at = Date.now()) {
  const lead = state.leads.find(item => item.id === id)
  if (!lead || lead.status === 'sent') return state
  const crmId = fail ? null : crmNumber(id)
  const updated = { ...lead, status: fail ? 'failed' : 'sent', crmId }
  const message = fail ? 'Ошибка передачи · демо-CRM недоступна' : 'Передано в демо-CRM · ' + crmId
  return { ...state, leads: state.leads.map(item => item.id === id ? updated : item), events: [eventFor(lead, message, at), ...state.events] }
}
