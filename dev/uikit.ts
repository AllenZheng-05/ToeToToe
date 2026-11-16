import { fontsReady } from '../src/ui/kit/fonts';
import {
  actCounter,
  banner,
  bar,
  button,
  gradePop,
  labelStrip,
  letterTiles,
  panel,
  phraseDots,
  playerPlate,
  progressBar,
  tapeNote,
  textInput,
  tornNote,
} from '../src/ui/kit/kit';

const app = document.getElementById('app') as HTMLElement;

function section(title: string): HTMLElement {
  const s = document.createElement('section');
  s.style.cssText = 'position:relative;padding:18px 40px';
  s.appendChild(labelStrip(title, { tone: 'blue' }));
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:16px 18px;margin-top:12px';
  s.appendChild(body);
  app.appendChild(s);
  return body;
}

function abs(node: HTMLElement, css: string): HTMLElement {
  node.style.cssText += `;position:absolute;${css}`;
  return node;
}

function build(): void {
  // Title lettering and banners
  const t = section('Letter tiles');
  const title = document.createElement('div');
  title.style.cssText = 'transform:rotate(-1deg);margin:8px 0';
  title.appendChild(letterTiles('TOE to TOE', { palette: 'title' }));
  t.appendChild(title);
  const b1 = banner();
  b1.set('ATTACK!');
  const b2 = banner();
  b2.set('PARRY!');
  const b3 = banner();
  b3.set('ALLEN WINS!', 'win');
  const b4 = banner();
  b4.set('3');
  t.append(b1.root, b2.root, b3.root, b4.root);
  t.append(letterTiles('ROW-G-12', { size: 44 }), letterTiles('BATTLE THEME', { size: 36 }));
  t.appendChild(letterTiles('ATTACK!', { seed: 3 }));

  // Strips and notes
  const n = section('Strips, tape and torn notes');
  n.append(
    labelStrip('ALLEN'),
    labelStrip('ROOM CODE', { tone: 'red' }),
    labelStrip('YOUR NAME', { tone: 'blue', rotate: -2 }),
  );
  n.append(
    tapeNote('tonight only! the socks do not match.', { rotate: 2 }),
    tapeNote('send this link to a friend', { rotate: -1 }),
  );
  n.append(
    tornNote('Click on the beat to plant a strike. Maya has to parry them next.', { width: 176 }),
    tornNote('"that one is just a sock."', { width: 170, rotate: 2 }),
  );

  // Buttons and inputs
  const bt = section('Buttons and inputs');
  bt.append(
    button('Create a room', { testId: 'b-primary' }),
    button('Join a room', { variant: 'pink' }),
    button('Workshop', { variant: 'secondary' }),
    button('Copy link', { variant: 'small' }),
    button('Leave', { variant: 'danger' }),
    button('Disabled', { disabled: true }),
    button('Disabled small', { variant: 'small', disabled: true }),
    button('Disabled paper', { variant: 'secondary', disabled: true }),
  );
  const inp = textInput({ label: 'ROOM CODE', placeholder: 'ROOM CODE' });
  const inp2 = textInput({ label: 'YOUR NAME', value: 'Allen' });
  const inp3 = textInput({ label: 'DISABLED' });
  inp3.input.disabled = true;
  bt.append(inp.root, inp2.root, inp3.root);

  // Panel, progress, grades
  const p = section('Panel, progress, grades');
  const pn = panel({ title: 'SEND A DRAWING' });
  const prog = progressBar({ label: 'Sending your puppet' });
  prog.set(0.42, 'Sending your puppet: 42%');
  pn.append(prog.root, button('Cancel', { variant: 'secondary' }));
  p.appendChild(pn);
  const pr2 = progressBar();
  pr2.set(0.8, 'Song: 80%');
  p.appendChild(pr2.root);
  const popHost = document.createElement('div');
  popHost.style.cssText = 'display:flex;gap:18px;min-width:420px;min-height:70px;align-items:center';
  p.appendChild(popHost);
  const show = (): void => popHost.replaceChildren(gradePop('bravo'), gradePop('good'), gradePop('miss'));
  p.appendChild(button('Show grades', { variant: 'small', onClick: show }));
  show();

  // Duel HUD as in mocks 5 and 6
  const stage = document.createElement('section');
  stage.style.cssText = 'position:relative;width:1280px;height:720px;overflow:hidden';
  stage.dataset.testid = 'dev-stage';
  const caption = labelStrip('Duel HUD, as in mock 5 (attacking) and mock 6 (defending)', { tone: 'blue' });
  stage.appendChild(abs(caption, 'left:40px;top:18px'));

  const ledge = document.createElement('div');
  ledge.style.cssText =
    'position:absolute;left:34px;top:603px;width:1216px;height:92px;box-sizing:border-box;border-top:5px solid #fff;box-shadow:0 -6px 0 rgba(0,0,0,0.22);background:#b99a6b';
  stage.appendChild(ledge);

  const actBox = document.createElement('div');
  actBox.style.cssText =
    'position:absolute;left:0;top:146px;width:1280px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none';
  const act = actCounter();
  act.set(2, 3, [1, 0]);
  const bn = banner();
  bn.set('ATTACK!');
  actBox.append(act.root, bn.root);
  stage.appendChild(actBox);

  stage.appendChild(
    abs(
      tornNote('Click on the beat to plant a strike. Maya has to parry them next.', { width: 176 }),
      'left:60px;top:150px',
    ),
  );
  stage.appendChild(
    abs(
      tapeNote('every strike costs stamina. long leaps cost more!', { rotate: -5 }),
      'left:96px;top:300px;width:300px',
    ),
  );

  const left = playerPlate({ align: 'left', testIdSuffix: '0' });
  left.setName('ALLEN');
  left.setYou(true);
  left.health.set(72, 100);
  left.stamina.set(46, 100);
  abs(left.root, 'left:186px;top:609px');
  const right = playerPlate({ align: 'right', testIdSuffix: '1' });
  right.setName('MAYA');
  right.health.set(54, 100);
  right.stamina.set(31, 100);
  right.setWinded(true);
  abs(right.root, 'right:186px;top:609px');
  stage.append(left.root, right.root);

  const dotsBox = document.createElement('div');
  dotsBox.style.cssText =
    'position:absolute;left:0;top:613px;width:1280px;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none';
  const cap = labelStrip('YOUR ATTACK, IN HALF-BEATS');
  cap.style.fontSize = '14px';
  const dots = phraseDots();
  dots.set({
    slots: 8,
    current: 4,
    filled: [true, true, false, true, true, false, false, false],
    tone: 'attack',
  });
  dotsBox.append(cap, dots.root);
  stage.appendChild(dotsBox);

  const row = document.createElement('div');
  row.style.cssText =
    'position:absolute;left:760px;top:300px;display:flex;flex-direction:column;align-items:flex-start;gap:14px';
  const dDots = phraseDots();
  dDots.set({
    slots: 8,
    current: 3,
    filled: [true, false, false, false, false, false, true, false],
    tone: 'defend',
  });
  const iDots = phraseDots();
  iDots.set({
    slots: 8,
    current: -1,
    filled: [true, false, true, false, false, false, false, false],
    tone: 'idle',
  });
  const hb = bar('health', { align: 'right' });
  hb.set(30, 30);
  const sb = bar('stamina');
  sb.set(0, 30);
  row.append(labelStrip('Defend dots'), dDots.root, labelStrip('Idle dots'), iDots.root, hb.root, sb.root);
  stage.appendChild(row);

  app.appendChild(stage);
}

build();
void fontsReady().then(() => {
  document.body.dataset.fonts = 'ready';
});
