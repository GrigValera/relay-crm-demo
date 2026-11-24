import { storageKey, teams, samples, restoreState, receive, transfer } from './model.mjs'

const pages = {
  queue: ['Очередь обращений', 'Откройте заявку, проверьте назначение и передайте её в CRM.'],
  rules: ['Маршрутизация', 'Назначение команды по каналу поступления.'],
  history: ['Журнал событий', 'Получение заявок, ошибки передачи и подтверждения CRM.'],
}
const stateLabels = { new: 'Новые', failed: 'Нужен повтор', sent: 'Переданы' }
const badgeLabels = { new: 'Новая', failed: 'Ошибка CRM', sent: 'Передана' }
const el = id => document.getElementById(id)
const view = el('view')
const status = el('status')
const heading = el('page-title')
const intake = el('intake')
const intakeButton = el('show-intake')
const channel = el('intake-channel')
const dateFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
let state = readState()
let filter = 'all'

function readState() {
  try { return restoreState(JSON.parse(localStorage.getItem(storageKey) || 'null')) }
  catch { return restoreState(null) }
}

async function commit(change) {
  const save = () => {
    let current = state
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) current = restoreState(JSON.parse(saved))
    } catch { /* Keep the current session usable if storage is unavailable. */ }
    const next = change(current)
    const changed = next !== current
    state = next
    try {
      if (changed) localStorage.setItem(storageKey, JSON.stringify(next))
      return { changed, persisted: true }
    } catch {
      return { changed, persisted: false }
    }
  }
  return navigator.locks ? navigator.locks.request(storageKey, save) : save()
}

function announce(message, result) {
  status.textContent = result?.persisted === false ? message + ' Браузер не сохранил изменения.' : message
}

function node(tag, text, className) {
  const element = document.createElement(tag)
  if (text !== undefined) element.textContent = text
  if (className) element.className = className
  return element
}

function timeline(events, showLinks = false) {
  const list = node('ol', undefined, 'timeline')
  for (const event of events) {
    const row = node('li')
    const stamp = node('time', dateFormat.format(event.at))
    stamp.dateTime = new Date(event.at).toISOString()
    if (showLinks) {
      const link = node('a', 'Заявка №' + event.lead + ' · ' + event.name)
      link.href = '#queue/' + event.lead
      link.addEventListener('click', () => { filter = 'all' })
      row.append(link)
    }
    row.append(node('strong', event.text), stamp)
    list.append(row)
  }
  return list
}

function badge(lead) {
  return node('small', badgeLabels[lead.status], 'badge ' + lead.status)
}

function openLead(id) {
  const target = '#queue/' + id
  if (location.hash === target) focusDetail()
  else location.hash = target
}

function focusDetail() {
  el('lead-title')?.focus()
}

function renderQueue(id) {
  const metrics = node('div', undefined, 'metrics')
  for (const [value, label] of Object.entries(stateLabels)) {
    const tile = node('div', undefined, 'panel metric ' + value)
    tile.append(node('span', label), node('strong', String(state.leads.filter(lead => lead.status === value).length)))
    metrics.append(tile)
  }

  const inbox = node('div', undefined, 'inbox')
  const left = node('section', undefined, 'panel')
  const listHead = node('div', undefined, 'list-head')
  const listTitle = node('h2', 'Входящие')
  const select = node('select')
  select.setAttribute('aria-label', 'Статус заявки')
  select.append(new Option('Все статусы', 'all'), ...Object.entries(stateLabels).map(([value, label]) => new Option(label, value)))
  select.value = filter
  select.addEventListener('change', () => {
    filter = select.value
    render()
    view.querySelector('select').focus()
  })
  listHead.append(listTitle, select)
  left.append(listHead)

  const matches = state.leads.filter(lead => filter === 'all' || lead.status === filter)
  const selected = matches.find(lead => lead.id === id) || matches[0]
  if (matches.length) {
    const list = node('ul', undefined, 'request-list')
    for (const lead of matches) {
      const row = node('li')
      const link = node('a', undefined, 'request-link')
      link.href = '#queue/' + lead.id
      if (selected?.id === lead.id) link.setAttribute('aria-current', 'true')
      link.addEventListener('click', event => {
        if (location.hash === link.hash) {
          event.preventDefault()
          focusDetail()
        }
      })
      const top = node('span')
      top.append(node('small', '№' + lead.id + ' · ' + lead.source, 'meta'), badge(lead))
      link.append(top, node('strong', lead.subject), node('small', lead.name + ' · ' + lead.queue, 'meta'))
      row.append(link)
      list.append(row)
    }
    left.append(list)
  } else {
    left.append(node('p', 'Заявок с этим статусом пока нет.', 'empty'))
  }
  inbox.append(left)
  if (selected) inbox.append(renderDetail(selected))
  view.append(metrics, inbox)
}

function renderDetail(lead) {
  const panel = node('section', undefined, 'panel detail')
  panel.setAttribute('aria-labelledby', 'lead-title')
  const top = node('div', undefined, 'detail-top')
  top.append(node('span', 'Заявка №' + lead.id, 'meta'), badge(lead))
  const title = node('h2', lead.subject)
  title.id = 'lead-title'
  title.tabIndex = -1
  const details = node('dl', undefined, 'details')
  const fields = [
    ['Отправитель', lead.name],
    ['Канал', lead.source],
    ['Получено', lead.receivedAt === null ? 'Дата не записана' : dateFormat.format(lead.receivedAt)],
    ['Команда по правилу', lead.queue],
  ]
  if (lead.crmId) fields.push(['Запись в демо-CRM', lead.crmId])
  for (const [label, value] of fields) {
    const row = node('div')
    row.append(node('dt', label), node('dd', value))
    details.append(row)
  }
  const message = node('div', undefined, 'message')
  message.append(node('h3', 'Сообщение'), node('p', lead.body))
  panel.append(top, title, details, message)
  if (lead.status === 'failed') panel.append(node('p', 'Демо-CRM временно недоступна. Заявка сохранена, передачу можно повторить.', 'alert'))
  if (lead.status !== 'sent') panel.append(transferControls(lead))
  const events = state.events.filter(event => event.lead === lead.id)
  if (events.length) panel.append(node('h3', 'События по заявке'), timeline(events))
  return panel
}

function transferControls(lead) {
  const actions = node('div', undefined, 'detail-actions')
  const action = node('button', lead.status === 'failed' ? 'Повторить передачу' : 'Передать в демо-CRM')
  action.type = 'button'
  const fail = node('input')
  fail.type = 'checkbox'
  const label = node('label')
  label.append(fail, node('span', 'Имитировать сбой CRM'))
  actions.append(action, label)
  action.addEventListener('click', async () => {
    action.disabled = true
    const result = await commit(current => transfer(current, lead.id, fail.checked))
    const updated = state.leads.find(item => item.id === lead.id)
    if (filter !== 'all' && filter !== updated?.status) filter = 'all'
    if (updated?.status === 'failed') announce('Передача заявки №' + lead.id + ' не удалась.', result)
    else announce('Заявка №' + lead.id + ' сохранена в демо-CRM под номером ' + updated?.crmId + '.', result)
    if (location.hash !== '#queue/' + lead.id) openLead(lead.id)
    else { render(); focusDetail() }
  })
  return actions
}

function renderRules() {
  const form = node('form', undefined, 'panel rules')
  form.append(node('h2', 'Команда для каждого канала'), node('p', 'Изменения применятся к следующим заявкам. Назначение уже полученных заявок сохранится.', 'meta'))
  for (const { source } of samples) {
    const label = node('label', undefined, 'rule-row')
    const select = node('select')
    select.name = source
    select.append(...teams.map(team => new Option(team, team)))
    select.value = state.rules[source]
    label.append(node('span', source), select)
    form.append(label)
  }
  const submit = node('button', 'Сохранить правила')
  form.append(submit)
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const rules = Object.fromEntries(new FormData(form))
    const result = await commit(current => ({ ...current, rules }))
    announce('Правила маршрутизации сохранены.', result)
  })
  view.append(form)
}

function renderHistory() {
  const panel = node('section', undefined, 'panel journal')
  panel.append(node('h2', 'Все события'))
  if (state.events.length) panel.append(timeline(state.events, true))
  else panel.append(node('p', 'Событий пока нет. Добавьте тестовую заявку.', 'meta'))
  view.append(panel)
}

function render() {
  const [slug, id] = location.hash.slice(1).split('/')
  const page = Object.hasOwn(pages, slug) ? slug : 'queue'
  heading.textContent = pages[page][0]
  el('page-description').textContent = pages[page][1]
  for (const link of document.querySelectorAll('nav a')) {
    if (link.hash === '#' + page) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
  view.replaceChildren()
  if (page === 'queue') renderQueue(Number(id))
  if (page === 'rules') renderRules()
  if (page === 'history') renderHistory()
}

function setIntake(open) {
  intake.hidden = !open
  intakeButton.setAttribute('aria-expanded', String(open))
  if (open) channel.focus()
}

channel.append(...samples.map(({ source }) => new Option(source, source)))
channel.value = samples[2].source
intakeButton.addEventListener('click', () => setIntake(intake.hidden))
intake.addEventListener('submit', async event => {
  event.preventDefault()
  const source = channel.value
  const result = await commit(current => receive(current, source))
  const lead = state.leads[0]
  filter = 'all'
  setIntake(false)
  announce('Заявка №' + lead.id + ' поступила в очередь «' + lead.queue + '».', result)
  openLead(lead.id)
})

window.addEventListener('hashchange', () => {
  render()
  if (location.hash.startsWith('#queue/')) focusDetail()
  else if (location.hash !== '#workspace') heading.focus()
})
window.addEventListener('storage', event => {
  if (event.key === storageKey || event.key === null) {
    state = readState()
    // Preserve focus and unsaved rule selections in the active tab.
    if (!view.contains(document.activeElement)) render()
  }
})
render()
