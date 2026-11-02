import { analisarImagemComIA, tradutorTracos, guardarFlorNoFirebase, carregarFloresDoFirebase } from './engine.js';

// --- ELEMENTOS DO DOM ---
const btnPlantar = document.getElementById('btn-plantar');
const videoElem = document.getElementById('camera-stream');
const canvasElem = document.getElementById('capture-canvas');
const popupElem = document.getElementById('analysis-popup');
const popupTitle = document.getElementById('popup-title');
const traitsListElem = document.getElementById('traits-list');
const btnConfirm = document.getElementById('btn-confirm-flower');
const mensagemElem = document.getElementById('mensagem-flor');

let florAtual = null;
let particulas = [];
const imgCentroGlob = new Image();
imgCentroGlob.src = "data/centro.png"; 

let floresRenderizadas = []; 
let tocadorX = 0;
let jardimATocar = true; 
let modoLoop = true; // True = loop infinito, False = toca apenas uma vez
const velocidadeMusica = 0.5;

const musicaFundo = new Audio('data/musica_fundo.mp3');
musicaFundo.loop = true;
musicaFundo.volume = 0.4;

// VARIÁVEIS PARA O DRAG AND DROP DAS FLORES
let florSelecionada = null;
let offsetX = 0;
let offsetY = 0;

// --- ANIMAÇÃO DA SEMENTE E CRESCIMENTO DA FLOR ---
const SEMENTE_QUEDA_MS = 1200;  // tempo que a semente demora a cair do topo até à flor
const CRESCIMENTO_MS = 3000;    // tempo que a flor demora a crescer até ao tamanho final
const ESCALA_INICIAL = 0.03;    // tamanho com que a flor começa (0 = nada, 1 = tamanho final)
let sementes = [];              // sementes que estão a cair neste momento

// Onde fica a base do caule dentro da imagem da flor (0 a 1, a partir do canto sup. esq.).
// A flor cresce "para cima" a partir deste ponto e a semente cai aqui.
const BASE_CAULE = { x: 0.5, y: 0.91 };

function baseDaFlor(f) {
  return {
    x: f.posX + f.tamanho * BASE_CAULE.x,
    y: f.posY + f.tamanho * BASE_CAULE.y
  };
}

// Evita que texto escrito pelos utilizadores seja interpretado como HTML
function escaparHtml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- ARRANQUE DO JARDIM: PLAYHEAD + MÚSICA DE FUNDO AO MESMO TEMPO ---
let jardimIniciado = false;   // já se deu o arranque (acontece quando aparecem as primeiras flores)
let playheadAtiva = false;    // a playhead já pode aparecer e andar
let aEsperarGesto = false;

function iniciarJardim() {
  jardimIniciado = true;
  tocadorX = 0;
  floresRenderizadas.forEach(f => f.foiTocado = false);

  // Se a pessoa pôs o jardim em pausa antes de as flores aparecerem, não toca nada
  if (!jardimATocar) {
    playheadAtiva = true;
    return;
  }

  musicaFundo.currentTime = 0;
  musicaFundo.play()
    .then(() => {
      playheadAtiva = true;   // a playhead arranca no mesmo instante que a música
    })
    .catch(() => {
      // O browser bloqueou o som automático: a playhead arranca na mesma
      // e a música entra no primeiro gesto da pessoa (clique, toque ou tecla)
      playheadAtiva = true;
      esperarPrimeiroGesto();
    });
}

const EVENTOS_GESTO = ['pointerdown', 'click', 'keydown', 'touchend'];

function esperarPrimeiroGesto() {
  if (aEsperarGesto) return;
  aEsperarGesto = true;

  const aoGesto = () => {
    EVENTOS_GESTO.forEach(ev => document.removeEventListener(ev, aoGesto, true));
    aEsperarGesto = false;
    if (!jardimATocar) return;   // em pausa: a música só entra quando se carregar em play

    musicaFundo.currentTime = 0;
    musicaFundo.play()
      .then(() => {
        // Recomeça a playhead para ficar alinhada com o início da música
        tocadorX = 0;
        floresRenderizadas.forEach(f => f.foiTocado = false);
      })
      .catch(() => esperarPrimeiroGesto());   // este gesto não serviu: tenta no seguinte
  };

  EVENTOS_GESTO.forEach(ev => document.addEventListener(ev, aoGesto, true));
}

// --- LÓGICA DE ESCOLHA DA PÉTALA (FORMA + COR) ---
function obterImagemPetala(hairType, color) {
  let forma = "redonda"; 
  if (hairType === "curly" || hairType === "coily") forma = "caracol";
  else if (hairType === "straight") forma = "ponta";
  else if (hairType === "wavy" || hairType === "none") forma = "redonda";

  const mapaFicheiros = {
    "caracol": {
      "red": "petalacaracol_vermelha.png", 
      "yellow": "petalacaracol_amarela.png",
      "blue": "petalacaracol_azul.png",
      "orange": "petalacaracol_laranja.png",
      "purple": "petalacaracol_roxa.png"
    },
    "ponta": {
      "red": "petalaponta_vermelho.png",
      "yellow": "petalaponta_amarelo.png",
      "blue": "petalaponta_azul.png",
      "orange": "petalaponta_laranja.png",
      "purple": "petalaponta_roxa.png"
    },
    "redonda": {
      "red": "petalaredonda_vermelha.png",
      "yellow": "petalaredonda_amarela.png",
      "blue": "petalaredonda_azul.png",
      "orange": "petalaredonda_laranja.png",
      "purple": "petalaredonda_roxa.png"
    }
  };

  if (mapaFicheiros[forma] && mapaFicheiros[forma][color]) {
    return mapaFicheiros[forma][color];
  }
  return "petalaredonda_vermelha.png";
}

function obterHexDaCor(color) {
  const hexCores = {
    'red': '#FF0000', 'yellow': '#FFD700', 'blue': '#0000FF', 
    'orange': '#FFA500', 'purple': '#800080'
  };
  return hexCores[color] || '#FF0000';
}

// --- LÓGICA DE ÁUDIO ---
function tocarAcordeDaFlor(cor) {
  const mapaSons = {
    'red': 'data/acorde_do.mp3',
    'yellow': 'data/acorde_fa.mp3',
    'blue': 'data/acorde_la.mp3',
    'orange': 'data/acorde_sol.mp3',
    'purple': 'data/acorde_mi.mp3'
  };
  const ficheiroSom = mapaSons[cor] || 'data/acorde_do.mp3';
  const audio = new Audio(ficheiroSom);
  audio.play().catch(() => {});   // o browser pode bloquear o som antes da primeira interação
}

// --- TRANSIÇÃO INICIAL ---
// IMPORTANTE: o ui.js é carregado com import() dinâmico (ver index.html), por isso o evento
// 'load' pode já ter acontecido quando este código corre. Se só ouvíssemos o 'load', a animação
// do título (e o desenho do jardim) falhava de vez em quando. Por isso verificamos o readyState.
function arrancarIntro() {
  const mainTitle = document.getElementById('main-title');
  setTimeout(() => {
    if (mainTitle) {
      mainTitle.classList.add('corner');
    }
    setTimeout(async () => {
      await desenharJardimCompleto();
      console.log("Jardim pronto e flores desenhadas!");
    }, 1500);
  }, 2000);
}

if (document.readyState === 'complete') {
  arrancarIntro();   // a página já carregou: arranca já
} else {
  window.addEventListener('load', arrancarIntro, { once: true });
}

// --- FLUXO DA CÂMARA E IA ---
btnPlantar.addEventListener('click', async () => {
  popupElem.classList.remove('hidden');
  popupTitle.innerText = "A ligar a câmara...";
  traitsListElem.innerHTML = "";
  btnConfirm.classList.add('hidden');
  mensagemElem.value = "";
  mensagemElem.classList.add('hidden');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
    videoElem.srcObject = stream;
    await new Promise(resolve => videoElem.onplaying = resolve);
    popupTitle.innerText = "Olha para a câmara...";
    setTimeout(() => {
      captureAndAnalyze(stream);
    }, 2000);
  } catch (err) {
    popupTitle.innerText = "Ups!";
    traitsListElem.innerHTML = "<p>Não foi possível aceder à câmara.</p>";
    console.error("Erro de câmara:", err);
  }
});

async function captureAndAnalyze(stream) {
  const MAX_SIZE = 512;
  const scale = Math.min(1, MAX_SIZE / Math.max(videoElem.videoWidth, videoElem.videoHeight));
  canvasElem.width = videoElem.videoWidth * scale;
  canvasElem.height = videoElem.videoHeight * scale;
  const ctx = canvasElem.getContext('2d');
  ctx.drawImage(videoElem, 0, 0, canvasElem.width, canvasElem.height);
  
  stream.getTracks().forEach(track => track.stop());

  popupTitle.innerText = "A IA está a olhar para ti...";

  try {
    const fullDataUrl = canvasElem.toDataURL('image/jpeg', 0.8);
    const base64Data = fullDataUrl.replace(/^data:image\/jpeg;base64,/, "");

    const aiTraits = await analisarImagemComIA(base64Data);

    const corIA = aiTraits.predominantColor || 'red';
    const cabeloIA = aiTraits.hairType || 'straight';

    aiTraits.Cor = obterHexDaCor(corIA);
    aiTraits.imagemPetala = obterImagemPetala(cabeloIA, corIA);

    florAtual = aiTraits;
    mostrarResultados(aiTraits);
  } catch (erro) {
    console.error(erro);
    popupTitle.innerText = "Ups!";
    traitsListElem.innerHTML = "<p>A IA teve um pequeno soluço. Tenta novamente.</p>";
    btnConfirm.classList.remove('hidden');
    btnConfirm.innerText = "Fechar";
  }
}

function mostrarResultados(traits) {
  popupTitle.innerText = "A tua flor será...";
  traitsListElem.innerHTML = "";

  for (const [key, rawValue] of Object.entries(traits)) {
    if (key === 'summary' || key === 'Cor') continue;
    const traducao = tradutorTracos[key];
    if (traducao) {
      const nomeAmigavel = traducao.label;
      const valorAmigavel = traducao.values[rawValue] || rawValue;
      traitsListElem.innerHTML += `
        <div class="trait-item">
          <strong>${nomeAmigavel}</strong>
          <span>${valorAmigavel}</span>
        </div>
      `;
    }
  }

  traitsListElem.innerHTML += `
    <div class="trait-item">
      <strong>Tom base</strong>
      <span style="display:inline-block; width:18px; height:18px; background:${traits.Cor}; border-radius:50%; border: 1px solid #3b2350;"></span>
    </div>
  `;

  mensagemElem.classList.remove('hidden');
  btnConfirm.classList.remove('hidden');
  btnConfirm.innerText = "Semear esta flor";
}

btnConfirm.addEventListener('click', async () => {
  if (!florAtual) {
    popupElem.classList.add('hidden');
    return;
  }

  btnConfirm.innerText = "A semear na nuvem...";
  btnConfirm.disabled = true;

  try {
    const florParaGuardar = {
      name: "Anónimo",
      height: 170,
      accent: florAtual.Cor, 
      imagemPetala: florAtual.imagemPetala,
      summary: mensagemElem.value.trim().slice(0, 140),   // mensagem escrita pelo utilizador
      source: "ai",
      seed: Math.floor(Math.random() * 1000000),
      traits: {
        age: florAtual.age || 'adult',
        glasses: florAtual.glasses || 'none',
        hairLength: florAtual.hairLength || 'medium',
        hairType: florAtual.hairType || 'straight',
        expression: florAtual.expression || 'neutral',
        facialHair: florAtual.facialHair || 'none',
        predominantColor: florAtual.predominantColor || 'red',
        season: 'spring'
      }
    };

    const idNova = await guardarFlorNoFirebase(florParaGuardar);
    florAtual = null;

    // Redesenha o jardim com a flor nova ainda escondida, à espera da semente
    await desenharJardimCompleto(idNova);
    popupElem.classList.add('hidden');

    // Larga a semente do topo da tela até ao centro da flor
    const nova = floresRenderizadas.find(f => f.flor.id === idNova);
    if (nova) {
      sementes.push({ f: nova, inicio: performance.now(), duracao: SEMENTE_QUEDA_MS });
    }
  } catch (erro) {
    console.error("ERRO NO FIREBASE:", erro);
    alert("O Firebase bloqueou a flor. Abre a consola (F12) para ver porquê!");
  } finally {
    btnConfirm.innerText = "Semear esta flor";
    btnConfirm.disabled = false;
  }
});

function obterNomeImagemFlor(traits) {
  if (!traits) return "caule_sem_oculos.png";
  const temOculos = traits.glasses && traits.glasses !== 'none';
  const temBarba = traits.facialHair && traits.facialHair !== 'none';

  if (temOculos && temBarba) {
    return "caule_oculos_barba.png";
  } else if (temOculos && !temBarba) {
    return "caule_oculos.png";
  } else if (!temOculos && temBarba) {
    return "caule_sem_oculos_barba.png";
  } else {
    return "caule_sem_oculos.png";
  }
}

function obterNumeroPetalas(age) {
  switch (age) {
    case 'child': return 5;
    case 'teen': return 6;
    case 'young_adult': return 5;
    case 'adult': return 8;
    case 'senior': return 9;
    default: return 6;
  }
}

function obterEscalaPetala(hairLength) {
  switch (hairLength) {
    case 'shaved': return 0.5;
    case 'short': return 0.75;
    case 'medium': return 1.0;
    case 'long': return 1.5;
    default: return 1.0;
  }
}

// --- FUNÇÃO PARA POSICIONAR AS FLORES DE FORMA FIXA E ESTÁVEL ---
async function desenharJardimCompleto(idNova = null) {
  const flores = await carregarFloresDoFirebase();
  const canvas = document.getElementById('stage');
  if (!canvas) return;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  floresRenderizadas = [];
  if (flores.length === 0) return;

  let tamanhoFlor = Math.min(canvas.width, canvas.height) * 0.25;
  tamanhoFlor = Math.max(100, Math.min(350, tamanhoFlor));

  flores.sort((a, b) => (a.seed || 0) - (b.seed || 0));

  flores.forEach((flor) => {
    if (flor.traits && flor.seed) {
      const margem = 80;
      const areaUtilX = canvas.width - tamanhoFlor - (margem * 2);
      const areaUtilY = canvas.height - tamanhoFlor - (margem * 2);

      let randomX = (flor.seed % 1000) / 1000;
      let randomY = (Math.floor(flor.seed / 1000) % 1000) / 1000;

      let posX = margem + (areaUtilX > 0 ? areaUtilX * randomX : 0);
      let posY = margem + (areaUtilY > 0 ? areaUtilY * randomY : 0);

      let tentativas = 0;
      let colide = true;
      while (colide && tentativas < 15) {
        colide = false;
        for (let f of floresRenderizadas) {
          let distancia = Math.hypot((posX + tamanhoFlor / 2) - f.centroX, (posY + tamanhoFlor / 2) - f.centroY);
          if (distancia < tamanhoFlor * 0.6) {
            colide = true;
            posX += 30;
            posY += 20;
            break;
          }
        }
        tentativas++;
      }

      const imgCaule = new Image();
      imgCaule.src = "data/" + obterNomeImagemFlor(flor.traits);

      const imgPetala = new Image();
      imgPetala.src = "data/" + (flor.imagemPetala || "petalaredonda_vermelha.png");

      floresRenderizadas.push({
        flor: flor,
        posX: posX,
        posY: posY,
        tamanho: tamanhoFlor,
        centroX: posX + (tamanhoFlor / 2),
        centroY: posY + (tamanhoFlor / 2),
        corHex: obterHexDaCor(flor.traits.predominantColor),
        imgCaule: imgCaule,
        imgPetala: imgPetala,
        foiTocado: tocadorX >= (posX + (tamanhoFlor / 2)),
        tempoEspera: (flor.seed % 300) + 100, 
        emMovimento: false,
        progressoMovimento: 0,
        escalaPetala: obterEscalaPetala(flor.traits.hairLength),
        escondida: idNova !== null && flor.id === idNova,  // a flor nova só aparece quando a semente chega
        escalaCrescimento: 1,
        inicioCrescimento: null
      });
    }
  });

  floresRenderizadas.sort((a, b) => a.posY - b.posY);
}

function desenharFlorSincrona(f, swayX, swayY, rotacao, ctx) {
  const numPetalas = obterNumeroPetalas(f.flor.traits.age);
  const esc = f.escalaCrescimento ?? 1;   // 1 = tamanho normal; menor = a crescer
  const t = f.tamanho * esc;
  // Encolhe com a base do caule fixa: a flor cresce para cima a partir do chão
  const x = f.posX + f.tamanho * BASE_CAULE.x * (1 - esc) + swayX;
  const y = f.posY + f.tamanho * BASE_CAULE.y * (1 - esc) + swayY;
  
  if (f.imgCaule.complete) ctx.drawImage(f.imgCaule, x, y, t, t);

  ctx.save();
  ctx.translate(x + t / 2, y + t / 2);
  ctx.rotate(rotacao);

  for (let i = 0; i < numPetalas; i++) {
    ctx.save();
    ctx.rotate((i / numPetalas) * (Math.PI * 2));
    ctx.scale(1, f.escalaPetala);
    if (f.imgPetala.complete) {
      ctx.drawImage(f.imgPetala, -t / 2, (-t / 2) + 3 * esc, t, t);
    }
    ctx.restore();
  }
  ctx.restore();

  if (imgCentroGlob.complete) ctx.drawImage(imgCentroGlob, x, y + 4 * esc, t, t);
}

window.addEventListener('resize', () => {
  const mainTitle = document.getElementById('main-title');
  if (mainTitle && mainTitle.classList.contains('corner')) {
    desenharJardimCompleto();
  }
});

const canvas = document.getElementById('stage');

if (canvas) {
  canvas.addEventListener('mousedown', (e) => {
    if (jardimATocar) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    for (let i = floresRenderizadas.length - 1; i >= 0; i--) {
      let f = floresRenderizadas[i];
      let distancia = Math.hypot(mouseX - f.centroX, mouseY - f.centroY);
      
      if (distancia < f.tamanho / 2.5) {
        florSelecionada = f;
        offsetX = mouseX - f.posX;
        offsetY = mouseY - f.posY;
        canvas.style.cursor = 'grabbing';
        break;
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (florSelecionada) {
      florSelecionada.posX = mouseX - offsetX;
      florSelecionada.posY = mouseY - offsetY;
      florSelecionada.centroX = florSelecionada.posX + (florSelecionada.tamanho / 2);
      florSelecionada.centroY = florSelecionada.posY + (florSelecionada.tamanho / 2);
      return;
    }

    if (!jardimATocar) {
      let emcimaDeFlor = false;
      
      for (let i = 0; i < floresRenderizadas.length; i++) {
        let f = floresRenderizadas[i];
        let distancia = Math.hypot(mouseX - f.centroX, mouseY - f.centroY);
        
        if (distancia < f.tamanho / 2.5) {
          emcimaDeFlor = true;
          break;
        }
      }

      canvas.style.cursor = emcimaDeFlor ? 'grab' : 'default';
    } else {
      canvas.style.cursor = 'default';
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (florSelecionada) {
      florSelecionada = null;
      canvas.style.cursor = 'grab';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    florSelecionada = null;
    canvas.style.cursor = 'default';
  });
}

// --- CONTROLOS DOS NOVOS BOTÕES CIRCULARES ---
const btnPlayPause = document.getElementById('btn-play-pause');
const btnRestart = document.getElementById('btn-restart');
const btnLoop = document.getElementById('btn-loop');
const iconPlayPause = document.getElementById('icon-play-pause');

const ICONE_PAUSE = `
  <line x1="10" y1="6" x2="10" y2="18"></line>
  <line x1="14" y1="6" x2="14" y2="18"></line>
`;
const ICONE_PLAY = `<polygon points="6 3 20 12 6 21 6 3"></polygon>`;

// Fonte única de verdade: o ícone segue sempre o valor de jardimATocar
function atualizarIconePlayPause() {
  if (iconPlayPause) iconPlayPause.innerHTML = jardimATocar ? ICONE_PAUSE : ICONE_PLAY;
  if (btnPlayPause) btnPlayPause.title = jardimATocar ? 'Pausar' : 'Tocar';
}

if (btnPlayPause) {
  btnPlayPause.addEventListener('click', () => {
    jardimATocar = !jardimATocar;

    if (jardimATocar) {
      musicaFundo.play().catch(e => console.log("Erro ao tocar música:", e));
    } else {
      musicaFundo.pause();
    }
    atualizarIconePlayPause();
  });
}

if (btnRestart) {
  btnRestart.addEventListener('click', () => {
    tocadorX = 0;
    floresRenderizadas.forEach(f => f.foiTocado = false);
  });
}

if (btnLoop) {
  btnLoop.addEventListener('click', () => {
    modoLoop = !modoLoop;
    if (modoLoop) {
      btnLoop.classList.remove('inactive');
      btnLoop.title = "Modo: Loop Infinito";
    } else {
      btnLoop.classList.add('inactive');
      btnLoop.title = "Modo: Tocar apenas uma vez";
    }
  });
}

function desenharSemente(ctx, x, y, angulo, tamanhoFlor) {
  const r = Math.max(6, tamanhoFlor * 0.04);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angulo);
  ctx.fillStyle = '#6b4423';
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.65, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';   // brilho
  ctx.beginPath();
  ctx.ellipse(-r * 0.2, -r * 0.3, r * 0.17, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function criarParticulas(x, y, corHex) {
  for (let i = 0; i < 5; i++) {
    particulas.push({
      x: x,
      y: y,
      vx: (Math.random() - 0.5) * 3,
      vy: (Math.random() - 0.5) * 3 - 1,
      vida: 1,
      cor: corHex
    });
  }
}

function loopDeAudio() {
  const playheadDiv = document.getElementById('playhead');
  const canvas = document.getElementById('stage');
  const ctx = canvas ? canvas.getContext('2d') : null;

  if (!canvas || !ctx) {
    requestAnimationFrame(loopDeAudio);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Quando aparecem as primeiras flores, arranca tudo ao mesmo tempo
  if (!jardimIniciado && floresRenderizadas.some(f => !f.escondida)) {
    iniciarJardim();
  }

  if (jardimATocar && playheadAtiva) {
    if (playheadDiv) playheadDiv.style.display = 'block';

    tocadorX += velocidadeMusica; 
    if (playheadDiv) playheadDiv.style.transform = `translateX(${tocadorX}px)`;
    
    if (tocadorX > canvas.width) {
      if (modoLoop) {
        tocadorX = 0; 
        floresRenderizadas.forEach(f => f.foiTocado = false);
      } else {
        jardimATocar = false;
        tocadorX = 0;
        musicaFundo.pause();
        atualizarIconePlayPause();
      }
    }
  } else {
    if (playheadDiv) playheadDiv.style.display = 'none';
  }

  const agora = performance.now();

  floresRenderizadas.forEach(f => {
    // Flor nova: fica escondida até a semente chegar
    if (f.escondida) return;

    // Crescimento (baseado em tempo, por isso dura sempre 3s em qualquer ecrã)
    if (f.inicioCrescimento !== null) {
      const p = Math.min(1, (agora - f.inicioCrescimento) / CRESCIMENTO_MS);
      const suave = p * p * (3 - 2 * p);   // começa e acaba devagar
      f.escalaCrescimento = ESCALA_INICIAL + (1 - ESCALA_INICIAL) * suave;
      if (p >= 1) {
        f.inicioCrescimento = null;
        f.escalaCrescimento = 1;
      }
    }

    let swayX = 0;
    let swayY = 0;
    let rotacao = 0;

    if (f.emMovimento) {
      f.progressoMovimento += 0.008; 
      const suavidade = Math.sin(f.progressoMovimento * Math.PI);
      
      swayX = suavidade * 1.5;
      rotacao = suavidade * 0.015;

      if (f.progressoMovimento >= 1) {
        f.emMovimento = false;
        f.tempoEspera = Math.random() * 500 + 200;
      }
    } else {
      f.tempoEspera--;
      if (f.tempoEspera <= 0) {
        f.emMovimento = true;
        f.progressoMovimento = 0;
      }
    }

    if (jardimATocar && !f.foiTocado && tocadorX >= f.centroX) {
      tocarAcordeDaFlor(f.flor.traits.predominantColor);
      criarParticulas(f.centroX, f.centroY, f.corHex); 
      
      f.emMovimento = true;
      f.progressoMovimento = 0;
      f.foiTocado = true;
    }

    desenharFlorSincrona(f, swayX, swayY, rotacao, ctx);
  });

  for (let i = sementes.length - 1; i >= 0; i--) {
    const s = sementes[i];
    const p = Math.min(1, (agora - s.inicio) / s.duracao);

    if (p >= 1) {
      // Chegou: a semente desaparece (ficou plantada) e a flor começa a crescer
      sementes.splice(i, 1);
      s.f.escondida = false;
      s.f.foiTocado = tocadorX >= s.f.centroX;   // não toca o acorde "atrasado"
      s.f.escalaCrescimento = ESCALA_INICIAL;
      s.f.inicioCrescimento = agora;
    } else {
      const yInicio = -20;
      const base = baseDaFlor(s.f);   // a semente cai na base do caule
      const y = yInicio + (base.y - yInicio) * (p * p);   // acelera como se caísse
      desenharSemente(ctx, base.x, y, p * 4, s.f.tamanho);
    }
  }

  for (let i = particulas.length - 1; i >= 0; i--) {
    let p = particulas[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vida -= 0.03;

    if (p.vida <= 0) {
      particulas.splice(i, 1);
    } else {
      ctx.globalAlpha = p.vida;
      ctx.fillStyle = p.cor;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }
  }
  
  requestAnimationFrame(loopDeAudio);
}

requestAnimationFrame(loopDeAudio);

// --- ELEMENTOS DA VITRINE ---
const vitrinePopup = document.getElementById('vitrine-popup');
const btnFecharVitrine = document.getElementById('btn-fechar-vitrine');
const vitrineTraitsList = document.getElementById('vitrine-traits-list');
const vitrineCanvas = document.getElementById('vitrine-canvas');

// Medidas em píxeis do vitrine.png ORIGINAL (2560x2560), já recortado para
// data/vitrine_recortada.png. Mexe aqui se quiseres a flor maior/menor ou mais alta/baixa.
const VITRINE = {
  escala: 0.6,          // o recorte final = original * escala
  larguraRecorte: 1285,
  alturaRecorte: 2334,
  florTamanho: 1750,    // lado do quadrado da flor (igual ao "tamanho" no jardim)
  florX: -232,          // canto sup. esquerdo desse quadrado, relativo ao recorte
  florY: 317
};

function vitrineEstaAberta() {
  return vitrinePopup && !vitrinePopup.classList.contains('hidden');
}

// Abre a vitrine com uma flor específica
function abrirVitrineFlor(f) {
  // 1. Pausa a música e o jardim (e troca o ícone para "play")
  jardimATocar = false;
  musicaFundo.pause();
  atualizarIconePlayPause();

  // 2. Preenche as caraterísticas da pessoa
  vitrineTraitsList.innerHTML = "";
  const traits = f.flor.traits;

  if (f.flor.summary) {
    vitrineTraitsList.innerHTML += `<p style="font-style: italic; margin-bottom: 1rem; color: #555;">"${escaparHtml(f.flor.summary)}"</p>`;
  }

  for (const [key, rawValue] of Object.entries(traits)) {
    if (key === 'season') continue;
    const traducao = tradutorTracos[key];
    if (traducao) {
      const nomeAmigavel = traducao.label;
      const valorAmigavel = traducao.values[rawValue] || rawValue;
      vitrineTraitsList.innerHTML += `
        <div class="trait-item">
          <strong>${nomeAmigavel}</strong>
          <span>${valorAmigavel}</span>
        </div>
      `;
    }
  }

  // 3. Desenha a flor, em grande, dentro do canvas da vitrine
  if (vitrineCanvas) {
    const k = VITRINE.escala;
    vitrineCanvas.width = Math.round(VITRINE.larguraRecorte * k);
    vitrineCanvas.height = Math.round(VITRINE.alturaRecorte * k);

    const vCtx = vitrineCanvas.getContext('2d');
    vCtx.clearRect(0, 0, vitrineCanvas.width, vitrineCanvas.height);

    const florGigante = {
      ...f,
      posX: VITRINE.florX * k,
      posY: VITRINE.florY * k,
      tamanho: VITRINE.florTamanho * k,
      escalaCrescimento: 1
    };
    desenharFlorSincrona(florGigante, 0, 0, 0, vCtx);
  }

  // 4. Mostra o pop-up
  vitrinePopup.classList.remove('hidden');
}

// Fechar a vitrine
if (btnFecharVitrine) {
  btnFecharVitrine.addEventListener('click', () => {
    vitrinePopup.classList.add('hidden');
  });
}

// --- DETEÇÃO DE PALMAS VIA MICROFONE ---
const PALMAS = {
  margemPx: 20,        // tolerância (em px) entre o playhead e o centro da flor
  limiarPico: 0.35,    // volume mínimo (0 a 1) para contar como palma
  subidaMinima: 2.5,   // o pico tem de ser X vezes o ruído de fundo (música incluída)
  cooldownMs: 700,     // tempo mínimo entre palmas
  ignorarAposCliqueMs: 500,   // ignora picos de som perto de um clique/tecla (o microfone ouve o clique do rato)
  atrasoConfirmacaoMs: 120,   // espera um instante antes de confirmar a palma, para ver se foi só um clique
  debug: false         // põe true para veres os picos na consola e calibrares
};

let audioContext = null;
let analyser = null;
let ultimaPalmaTempo = 0;
let nivelFundo = 0.02;

// O microfone ouve o "clic" do rato e das teclas e confunde-os com palmas.
// Por isso guardamos o instante da última interação com o rato/teclado/ecrã.
let ultimaInteracaoTempo = 0;
['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'wheel', 'keydown', 'keyup', 'touchstart', 'touchend']
  .forEach(ev => {
    document.addEventListener(ev, () => { ultimaInteracaoTempo = Date.now(); }, true);
  });

async function iniciarDeteccaoPalmas() {
  try {
    // Sem cancelamento de eco / supressão de ruído: o browser trata uma palma como ruído e corta-a
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false
    });
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') await audioContext.resume();

    const microphone = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    microphone.connect(analyser);

    console.log("Microfone ativo para detetar palmas!");
    monitorizarVolume();
  } catch (err) {
    console.warn("Não foi possível aceder ao microfone para as palmas:", err);
  }
}

function monitorizarVolume() {
  const amostras = new Uint8Array(analyser.fftSize);

  function check() {
    // Forma de onda: um pico muito curto e forte (palma) aparece aqui, ao contrário da média das frequências
    analyser.getByteTimeDomainData(amostras);
    let pico = 0;
    for (let i = 0; i < amostras.length; i++) {
      pico = Math.max(pico, Math.abs(amostras[i] - 128) / 128);
    }

    const agora = Date.now();
    const subiuDeRepente = pico > nivelFundo * PALMAS.subidaMinima;

    if (PALMAS.debug && pico > 0.15) console.log("pico:", pico.toFixed(2), "fundo:", nivelFundo.toFixed(2));

    if (pico > PALMAS.limiarPico && subiuDeRepente && (agora - ultimaPalmaTempo) > PALMAS.cooldownMs) {
      ultimaPalmaTempo = agora;
      const instantePico = agora;

      // Espera um instante: se houve um clique/tecla à volta deste pico, foi o rato e não uma palma
      setTimeout(() => {
        if (ultimaInteracaoTempo >= instantePico - PALMAS.ignorarAposCliqueMs) {
          if (PALMAS.debug) console.log("Pico ignorado: coincidiu com um clique/tecla");
          return;
        }
        verificarCoincidenciaPalmaFlor();
      }, PALMAS.atrasoConfirmacaoMs);
    }

    // Média móvel lenta do volume ambiente (música, conversas...)
    nivelFundo = nivelFundo * 0.95 + pico * 0.05;
    requestAnimationFrame(check);
  }
  check();
}

// Quando o utilizador bate palma, vê qual a flor que o playhead está a atravessar
function verificarCoincidenciaPalmaFlor() {
  if (!jardimATocar) return;                                   // só com o jardim a tocar
  if (vitrineEstaAberta() || infoEstaAberto()) return;                             // já há uma vitrine aberta
  if (!popupElem.classList.contains('hidden')) return;         // a meio de plantar uma flor

  // A flor mais próxima do playhead, dentro da margem
  let melhor = null;
  let melhorDist = PALMAS.margemPx;
  for (const f of floresRenderizadas) {
    const d = Math.abs(tocadorX - f.centroX);
    if (d <= melhorDist) {
      melhor = f;
      melhorDist = d;
    }
  }

  if (melhor) {
    console.log("Palma sincronizada com sucesso numa flor!", melhor);
    abrirVitrineFlor(melhor);
  }
}

// Inicia o microfone na primeira vez que o utilizador clica na página (restrição dos browsers)
document.body.addEventListener('click', () => {
  if (!audioContext) {
    iniciarDeteccaoPalmas();
  }
}, { once: true });

// --- BOTÃO DE INFORMAÇÃO E DICAS ---
const btnInfo = document.getElementById('btn-info');
const infoPopup = document.getElementById('info-popup');
const btnFecharInfo = document.getElementById('btn-fechar-info');
const infoHint = document.getElementById('info-hint');

const DICAS_INFO = [
  "Sabes como nasce uma flor aqui?",
  "O teu cabelo diz muito sobre a tua flor…",
  "Há segredos escondidos neste jardim.",
  "Queres saber como se faz música com flores?",
  "Descobre tudo o que podes fazer neste jardim.",
  "Curioso? Carrega no i."
];
const DICA_VISIVEL_MS = 6000;      // quanto tempo cada frase fica visível
const DICA_ESPERA_MIN_MS = 20000;  // espera mínima entre frases
const DICA_ESPERA_MAX_MS = 45000;  // espera máxima entre frases

function infoEstaAberto() {
  return infoPopup && !infoPopup.classList.contains('hidden');
}

function abrirInfo() {
  esconderDica();
  infoPopup.classList.remove('hidden');
}

function fecharInfo() {
  infoPopup.classList.add('hidden');
}

if (btnInfo) btnInfo.addEventListener('click', abrirInfo);
if (btnFecharInfo) btnFecharInfo.addEventListener('click', fecharInfo);

// Fechar ao clicar no fundo desfocado ou com a tecla Esc
if (infoPopup) {
  infoPopup.addEventListener('click', (e) => {
    if (e.target === infoPopup) fecharInfo();
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && infoEstaAberto()) fecharInfo();
});

let ultimaDica = -1;
let temporizadorDica = null;

function esconderDica() {
  clearTimeout(temporizadorDica);
  infoHint.classList.remove('visible');
  btnInfo.classList.remove('chamar-atencao');
}

function mostrarDica() {
  // Não incomoda quando a pessoa já está a fazer outra coisa
  const ocupado = infoEstaAberto() || vitrineEstaAberta() || !popupElem.classList.contains('hidden');
  if (ocupado) return;

  let i;
  do {
    i = Math.floor(Math.random() * DICAS_INFO.length);
  } while (i === ultimaDica);
  ultimaDica = i;

  infoHint.textContent = DICAS_INFO[i];
  infoHint.classList.add('visible');
  btnInfo.classList.add('chamar-atencao');

  temporizadorDica = setTimeout(esconderDica, DICA_VISIVEL_MS);
}

function agendarDica(primeira = false) {
  const espera = primeira
    ? 12000
    : DICA_ESPERA_MIN_MS + Math.random() * (DICA_ESPERA_MAX_MS - DICA_ESPERA_MIN_MS);
  setTimeout(() => {
    mostrarDica();
    agendarDica();
  }, espera);
}

if (btnInfo && infoHint) agendarDica(true);