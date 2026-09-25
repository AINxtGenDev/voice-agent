const ui = Object.fromEntries([
  'customer-form', 'customer-name', 'customer-mobile', 'customer-product', 'contact-allowed', 'permission-note',
  'save-customer', 'customer-status', 'customer-select', 'customer-details', 'selected-mobile', 'selected-product',
  'selected-permission', 'selected-note', 'selected-recorded', 'activate-agent', 'delete-customer', 'calling-status', 'stop-call', 'topic-select',
].map(id => [id, document.getElementById(id)]));
let customers = [];
let busy = false;
let providerConfigured = false;
let providerReason = 'Telefonanbieter ist nicht eingerichtet.';
let call = null;
let callStatusKnown = false;
let pollingCall = false;
let pendingRequest = null;
const finishedCalls = new Set(['completed', 'failed', 'busy', 'no-answer', 'canceled']);
function callBlocked() { return !callStatusKnown || Boolean(call && (!finishedCalls.has(call.state) || !call.finalized)); }


function selected() { return customers.find(customer => customer.id === ui['customer-select'].value); }
function status(message) { ui['customer-status'].textContent = message; }
async function api(path, payload) {
  const response = await fetch(path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: payload === undefined ? {} : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  });
  const body = await response.json();
  if (!response.ok) {
    const messages = {
      400: 'Check the customer name, international mobile number, product, and permission note.',
      403: 'The request is not permitted. A call requires documented contact permission.',
      404: 'This customer no longer exists. Refresh the page to load current records.',
      409: path.startsWith('/api/calls') ? 'Anrufstart gesperrt. Laufenden oder ungeklärten Gesprächsstatus prüfen.' : 'A customer with this mobile number already exists.',
      503: 'Dienst nicht verfügbar. Den Anrufstatus vor einem erneuten Versuch prüfen.',
    };
    throw new Error(messages[response.status] || 'The local server could not complete this action. Please try again.');
  }
  return body;
}
function renderSelection() {
  const customer = selected();
  ui['customer-select'].disabled = busy || Boolean(pendingRequest) || callBlocked() || customers.length === 0;
  ui['save-customer'].disabled = busy;
  ui['delete-customer'].disabled = busy || callBlocked() || Boolean(pendingRequest) || !customer;
  ui['activate-agent'].disabled = busy || callBlocked() || !providerConfigured || !ui['topic-select'].value || !customer?.contactAllowed;
  ui['stop-call'].disabled = busy || !providerConfigured || !call || Boolean(call.finalized);
  ui['topic-select'].disabled = busy || Boolean(pendingRequest) || callBlocked();
  ui['customer-details'].hidden = !customer;
  if (customer) {
    ui['selected-mobile'].textContent = customer.mobile;
    ui['selected-product'].textContent = customer.product || 'Not recorded';
    ui['selected-permission'].textContent = customer.contactAllowed ? 'Documented by operator' : 'Not documented — calling blocked';
    ui['selected-note'].textContent = customer.permissionNote || 'No reference recorded';
    const date = new Date(customer.recordedAt);
    ui['selected-recorded'].textContent = Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
  }
  ui['calling-status'].textContent = !callStatusKnown ? 'Anrufstatus unbekannt. Neue Anrufe bleiben gesperrt.'
    : callBlocked() ? `Telefonat: ${call.state}. Sprachdienst: ${call.liveState}. Abschluss noch nicht bestätigt.`
    : pendingRequest ? 'Anfrageausgang ungeklärt. Ein erneuter Versuch verwendet dieselbe Anfragekennung.'
    : !providerConfigured ? `${providerReason} No customer call can be placed.`
    : !ui['topic-select'].value || !customer ? 'Choose a topic and a customer, then click “… start conversation”.'
      : !customer.contactAllowed ? 'Documented contact permission is required before calling.' : 'Telephone provider configured. Activation requests a customer call.';
}
function renderList(preferredId = ui['customer-select'].value) {
  ui['customer-select'].replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = customers.length ? 'Choose a customer…' : 'No saved customers';
  ui['customer-select'].append(placeholder);
  for (const customer of customers) {
    const option = document.createElement('option');
    option.value = customer.id;
    option.textContent = `${customer.name} · ${customer.mobile}`;
    ui['customer-select'].append(option);
  }
  if (customers.some(customer => customer.id === preferredId)) ui['customer-select'].value = preferredId;
  renderSelection();
}
ui['customer-select'].addEventListener('change', renderSelection);
let topics = [];
ui['topic-select'].addEventListener('change', () => {
  const topic = topics.find(item => item.id === ui['topic-select'].value);
  if (topic) document.getElementById('opening-preview').textContent = topic.opening;
  renderSelection();
});
ui['customer-form'].addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const name = ui['customer-name'].value.trim();
  const mobile = ui['customer-mobile'].value.replace(/[\s()-]/g, '');
  if (!name || !/^\+[1-9][0-9]{7,14}$/.test(mobile)) {
    status('Enter a name and an international mobile number beginning with +, followed by 8 to 15 digits.');
    (!name ? ui['customer-name'] : ui['customer-mobile']).focus();
    return;
  }
  busy = true;
  renderSelection();
  status('Saving customer…');
  try {
    const result = await api('/api/customers', {
      name, mobile, product: ui['customer-product'].value, contactAllowed: ui['contact-allowed'].checked,
      permissionNote: ui['permission-note'].value.trim(),
    });
    customers.push(result.customer);
    ui['customer-form'].reset();
    renderList(result.customer.id);
    status('Customer saved locally. No call was placed.');
  } catch (error) { status(error.message || 'The customer could not be saved.'); }
  finally { busy = false; renderSelection(); }
});
ui['delete-customer'].addEventListener('click', async () => {
  const customer = selected();
  if (busy || !customer) return;
  if (!window.confirm(`Delete the saved contact “${customer.name}”? This cannot be undone.`)) return;
  busy = true;
  renderSelection();
  try {
    await api('/api/customers/delete', { id: customer.id });
    customers = customers.filter(item => item.id !== customer.id);
    renderList();
    status('Customer deleted from local storage.');
  } catch (error) { status(error.message || 'The customer could not be deleted.'); }
  finally { busy = false; renderSelection(); }
});
ui['activate-agent'].addEventListener('click', async () => {
  const customer = selected();
  if (busy || callBlocked() || !providerConfigured || !ui['topic-select'].value || !customer?.contactAllowed) return;
  busy = true;
  renderSelection();
  try {
    pendingRequest ??= { customerId: customer.id, topicId: ui['topic-select'].value, requestId: crypto.randomUUID() };
    const result = await api('/api/calls', pendingRequest);
    call = result.call;
    pendingRequest = null;
    status('Anrufauftrag angenommen. Verbindungsaufbau und Gesprächsende werden überwacht.');
  } catch (error) { status(error.message || 'The call request failed.'); }
  finally { busy = false; await pollCalling(); renderSelection(); }
});

ui['stop-call'].addEventListener('click', async () => {
  if (busy || !call || call.finalized) return;
  busy = true;
  renderSelection();
  try {
    const result = await api('/api/calls/stop', {});
    call = result.call;
    status(call?.finalized ? 'Gesprächsende bestätigt.' : 'Beenden angefordert; Abschluss wird geprüft.');
  } catch { status('Gesprächsende nicht bestätigt. Status prüfen; keinen weiteren Anruf starten.'); }
  finally { busy = false; await pollCalling(); renderSelection(); }
});

async function pollCalling() {
  if (pollingCall) return;
  pollingCall = true;
  try {
    const result = await api('/api/calling-status');
    providerConfigured = result.configured === true;
    providerReason = result.reason || providerReason;
    call = result.call ?? null;
    callStatusKnown = true;
  } catch { callStatusKnown = false; }
  finally { pollingCall = false; renderSelection(); }
}

async function initialize() {
  busy = true;
  renderSelection();
  api('/api/topics').then(result => { topics = result.topics; }).catch(() => {});
  const results = await Promise.allSettled([api('/api/customers'), api('/api/calling-status')]);
  if (results[0].status === 'fulfilled') {
    customers = results[0].value.customers;
    renderList();
    status(customers.length ? `${customers.length} saved customer record${customers.length === 1 ? '' : 's'} loaded.` : 'No customers yet. Add a synthetic contact to begin.');
  } else status('Customer records could not be loaded. Check the local server and refresh this page.');
  if (results[1].status === 'fulfilled') {
    callStatusKnown = true;
    call = results[1].value.call ?? null;
    providerConfigured = results[1].value.configured === true;
    providerReason = results[1].value.reason || providerReason;
  } else providerReason = 'Telephone provider status is unavailable.';
  busy = false;
  renderSelection();
}
void initialize();
setInterval(() => void pollCalling(), 2500);
