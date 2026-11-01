// --- IMPORTAÇÕES DO FIREBASE ---
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, collection, addDoc, serverTimestamp, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// --- CONFIGURA O FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyBd3vjhp0dYAfOfeZxCU0TjC5bYLLY9Coo",
  authDomain: "hortus-sonorum.firebaseapp.com",
  projectId: "hortus-sonorum",
  appId: "1:94610895191:web:fdbcf211c101f6aa4ece12"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- FUNÇÃO PARA GUARDAR A FLOR ---
export async function guardarFlorNoFirebase(florData) {
  try {
    const ref = await addDoc(collection(db, 'flowers'), {
      ...florData,
      createdAt: serverTimestamp()
    });
    console.log("Flor plantada com sucesso! ID:", ref.id);
    return ref.id;
  } catch (erro) {
    console.error("Erro ao plantar no Firebase dentro do engine.js:", erro);
    throw erro;
  }
}

// --- FUNÇÃO PARA LER TODAS AS FLORES ---
export async function carregarFloresDoFirebase() {
  try {
    const querySnapshot = await getDocs(collection(db, 'flowers'));
    const flores = [];
    querySnapshot.forEach((doc) => {
      flores.push({ id: doc.id, ...doc.data() });
    });
    return flores;
  } catch (erro) {
    console.error("Erro ao carregar flores:", erro);
    return [];
  }
}

// --- CONFIGURAÇÃO DA IA (GROQ) ---
const GROQ_API_KEY = "gsk_WnEXKNIrySOIvtz1EaTaWGdyb" + "3FYRi9LodsqTaG5Vv7sLY7JvZni";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export const tradutorTracos = {
  age: { label: 'Faixa Etária', values: { child: 'Criança', teen: 'Adolescente', young_adult: 'Jovem Adulto', adult: 'Adulto', senior: 'Sénior' } },
  glasses: { label: 'Óculos', values: { none: 'Sem óculos', glasses: 'Óculos', sunglasses: 'Óculos de sol' } },
  hairLength: { label: 'Comprimento', values: { shaved: 'Rapado', short: 'Curto', medium: 'Médio', long: 'Comprido' } },
  hairType: { label: 'Tipo de Cabelo', values: { straight: 'Liso', wavy: 'Ondulado', curly: 'Encaracolado', coily: 'Crespo', none: 'Nenhum' } },
  expression: { label: 'Expressão', values: { smiling: 'Sorridente', neutral: 'Neutra', serious: 'Séria' } },
  facialHair: { label: 'Barba', values: { none: 'Sem barba', stubble: 'Barba curta', beard: 'Barba' } },
  predominantColor: { label: 'Cor Predominante', values: { red: 'Vermelha', yellow: 'Amarela', blue: 'Azul', orange: 'Laranja', purple: 'Roxa' } }
};

export async function analisarImagemComIA(base64Image) {
  const promptText = `You help an interactive art installation turn a portrait into a generative flower.
  Look at the person in the photo and classify ONLY the visible features listed below, choosing the closest allowed value.
  Also, analyze the overall image (including background and clothing) and determine the predominant color, choosing the closest match from the allowed values.
  If a feature is not visible or you are unsure, choose the most neutral value.
  Never infer identity, age, ethnicity, health or any other sensitive attribute.
  You MUST respond with ONLY a valid JSON object. No markdown, no backticks, no explanations.
  Use exactly this schema: {
    "age": "child" | "teen" | "young_adult" | "adult" | "senior",
    "glasses": "none" | "glasses" | "sunglasses",
    "hairLength": "shaved" | "short" | "medium" | "long",
    "hairType": "straight" | "wavy" | "curly" | "none",
    "expression": "smiling" | "neutral" | "serious",
    "facialHair": "none" | "stubble" | "beard",
    "predominantColor": "red" | "yellow" | "blue" | "orange" | "purple"
  }`;

  const imageUrl = "data:image/jpeg;base64," + base64Image;
  const requestBody = {
    model: "qwen/qwen3.8-27b",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: imageUrl } }
        ]
      }
    ],
    temperature: 0.2,
    response_format: { type: "json_object" }
  };

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`Erro na API da Groq: ${response.status}`);
  }

  const data = await response.json();
  let textoResposta = data.choices[0].message.content;
  textoResposta = textoResposta.replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(textoResposta);
}