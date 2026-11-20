// Sample data for the design. Tomorrow this will come from the database.
const dates = ['13 Oct', '20 Oct', '27 Oct', '3 Nov', '10 Nov', '17 Nov'];
const types = ['Class exercise', 'Homework', 'Class test', 'Class exercise', 'Homework', 'Class test'];
const typeColors = { 'Class exercise': '#1E5AA8', Homework: '#5B3BA8', 'Class test': '#F2A300' };
const topics = {
  Mathematics: ['Decimals', 'Decimals', 'Decimals', 'Percentages', 'Ratio & Proportion', 'Ratio & Proportion'],
  'Integrated Science': ['Matter', 'Matter', 'Matter', 'Energy', 'Energy', 'Energy']
};

const students = [
  ['Kwame Asante', 'JHS 2A', 'Mathematics', [70, 74, 72, 78, 80, 82]],
  ['Ama Boateng', 'JHS 2A', 'Mathematics', [82, 85, 80, 84, 88, 86]],
  ['Kofi Mensah', 'JHS 2A', 'Mathematics', [60, 58, 62, 55, 52, 50]],
  ['Akosua Owusu', 'JHS 2A', 'Mathematics', [55, 60, 64, 66, 70, 72]],
  ['Yaw Darko', 'JHS 2A', 'Mathematics', [62, 58, 54, 48, 44, 40]],
  ['Efua Quaye', 'JHS 2A', 'Mathematics', [68, 66, 70, 64, 60, 62]],
  ['Kojo Addo', 'JHS 2B', 'Mathematics', [50, 40, 46, 42, 30, 38]],
  ['Abena Sarpong', 'JHS 2B', 'Mathematics', [76, 78, 74, 80, 82, 84]],
  ['Nana Ofori', 'JHS 2B', 'Mathematics', [58, 62, 60, 66, 64, 68]],
  ['Esi Appiah', 'JHS 2B', 'Mathematics', [64, 0, 56, 50, 0, 46]],
  ['Kwabena Osei', 'JHS 2B', 'Integrated Science', [72, 70, 76, 74, 78, 80]],
  ['Adwoa Frimpong', 'JHS 3A', 'Integrated Science', [88, 90, 86, 92, 90, 94]],
  ['Fiifi Annan', 'JHS 3A', 'Integrated Science', [52, 56, 50, 58, 60, 62]],
  ['Afia Agyeman', 'JHS 3A', 'Integrated Science', [66, 60, 58, 54, 50, 48]],
  ['Yaa Nyarko', 'JHS 3A', 'Mathematics', [74, 72, 78, 76, 80, 78]],
  ['Selorm Tetteh', 'JHS 3A', 'Mathematics', [44, 48, 52, 56, 58, 64]]
].map(([name, cls, subject, scores]) => {
  const average = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const firstHalf = (scores[0] + scores[1] + scores[2]) / 3;
  const secondHalf = (scores[3] + scores[4] + scores[5]) / 3;
  const change = Math.round(secondHalf - firstHalf);
  return { name, cls, subject, scores, average, change, latest: scores[scores.length - 1], needsAttention: average < 50 || change <= -8 };
});

const grid = document.getElementById('student-grid');
const classFilter = document.getElementById('f-class');
const subjectFilter = document.getElementById('f-subject');
const attentionFilter = document.getElementById('f-attention');
const dialog = document.getElementById('student-dialog');

function trendText(change) {
  if (change >= 3) return { text: `▲ Up ${change}`, color: '#157F3B' };
  if (change <= -3) return { text: `▼ Down ${Math.abs(change)}`, color: '#B42318' };
  return { text: '● Steady', color: '#5B6472' };
}

function showStudents() {
  const list = students.filter((s) =>
    (classFilter.value === 'all' || s.cls === classFilter.value) &&
    (subjectFilter.value === 'all' || s.subject === subjectFilter.value) &&
    (!attentionFilter.checked || s.needsAttention)
  );
  document.getElementById('result-count').textContent = `Showing ${list.length} of ${students.length} students`;
  grid.innerHTML = '';
  list.forEach((s) => {
    const trend = trendText(s.change);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'student-card';
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px">
        <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-weight: 700; font-size: 16px">${s.name}</span><span style="font-size: 13px; color: #5B6472">${s.cls} · ${s.subject}</span></div>
        ${s.needsAttention ? '<span style="padding: 4px 8px; border-radius: 999px; background: #FDE8E7; color: #8F1D15; font-size: 12px; font-weight: 700">Needs attention</span>' : ''}
      </div>
      <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px">
        <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Latest</span><span style="font-weight: 700; font-size: 18px">${s.latest}%</span></div>
        <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Average</span><span style="font-weight: 700; font-size: 18px">${s.average}%</span></div>
        <div style="display: flex; flex-direction: column; gap: 2px"><span style="font-size: 12px; color: #5B6472">Trend</span><span style="font-weight: 700; font-size: 14px; color: ${trend.color}">${trend.text}</span></div>
      </div>`;
    card.addEventListener('click', () => openStudent(s));
    grid.appendChild(card);
  });
}

function openStudent(s) {
  document.getElementById('dlg-name').textContent = s.name;
  document.getElementById('dlg-meta').textContent = `${s.cls} · ${s.subject} · Average ${s.average}%`;
  const chart = document.getElementById('dlg-chart');
  const labels = document.getElementById('dlg-labels');
  const rows = document.getElementById('dlg-rows');
  chart.innerHTML = ''; labels.innerHTML = ''; rows.innerHTML = '';
  chart.setAttribute('aria-label', `Bar chart of ${s.name}'s scores: ${s.scores.map((v, i) => dates[i] + ' ' + v + '%').join(', ')}`);
  s.scores.forEach((score, i) => {
    // each bar's height is set by the score (no chart library)
    const col = document.createElement('div');
    col.style.cssText = 'flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 6px; height: 100%';
    col.innerHTML = `<span style="font-size: 13px; font-weight: 700">${score}%</span><div style="width: 100%; max-width: 64px; height: ${Math.max(score * 1.8, 2)}px; border-radius: 6px 6px 0 0; background: ${typeColors[types[i]]}"></div>`;
    chart.appendChild(col);
    const label = document.createElement('span');
    label.style.cssText = 'flex: 1; text-align: center; font-size: 12px; color: #5B6472';
    label.textContent = dates[i];
    labels.appendChild(label);
    const row = document.createElement('tr');
    row.style.borderTop = '1px solid #EEF1F6';
    row.innerHTML = `<td style="padding: 10px 8px">${dates[i]}</td><td style="padding: 10px 8px">${types[i]}</td><td style="padding: 10px 8px">${topics[s.subject][i]}</td><td style="padding: 10px 8px; text-align: right; font-weight: 700">${score === 0 ? 'Not submitted' : score + '%'}</td>`;
    rows.appendChild(row);
  });
  dialog.showModal();
}

document.getElementById('dlg-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
[classFilter, subjectFilter, attentionFilter].forEach((el) => el.addEventListener('change', showStudents));
showStudents();
