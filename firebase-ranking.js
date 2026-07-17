const firebaseConfig = window.FIREBASE_CONFIG;
const isConfigured = firebaseConfig
  && firebaseConfig.apiKey
  && !firebaseConfig.apiKey.startsWith('YOUR_')
  && firebaseConfig.projectId
  && !firebaseConfig.projectId.startsWith('YOUR_');

function dispatch(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function legacyDocumentId(entry, index) {
  const sourceId = entry.id || `${entry.name}-${entry.score}-${index}`;
  return `legacy-${encodeURIComponent(String(sourceId)).slice(0, 500)}`;
}

if (!isConfigured) {
  dispatch('ranking-store-unconfigured');
} else {
  initializeRankingStore().catch((error) => dispatch('ranking-store-error', error));
}

async function initializeRankingStore() {
  const [appSdk, authSdk, firestoreSdk] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js')
  ]);
  const { initializeApp } = appSdk;
  const { getAuth, signInAnonymously } = authSdk;
  const {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getFirestore,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc
  } = firestoreSdk;

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const userCredential = await signInAnonymously(auth);
  const ownerUid = userCredential.user.uid;

  const db = getFirestore(app);
  const entriesCollection = collection(db, 'rankingEntries');
  const entriesQuery = query(entriesCollection, orderBy('createdAt', 'asc'));

  const store = {
    subscribe(onEntries, onError) {
      return onSnapshot(entriesQuery, (snapshot) => {
        const entries = snapshot.docs.map((entryDocument) => ({
          id: entryDocument.id,
          name: entryDocument.data().name,
          score: entryDocument.data().score,
          createdAt: entryDocument.data().createdAt?.toMillis?.() || 0
        }));
        onEntries(entries);
      }, onError);
    },

    addEntry({ name, score }) {
      return addDoc(entriesCollection, {
        name,
        score,
        createdAt: serverTimestamp(),
        ownerUid
      });
    },

    deleteEntry(id) {
      return deleteDoc(doc(db, 'rankingEntries', id));
    },

    async importLocalEntries(localEntries) {
      for (const [index, entry] of localEntries.entries()) {
        const name = String(entry.name || '').trim().slice(0, 20);
        const score = Number(entry.score);
        if (!name || !Number.isFinite(score) || score <= 0 || score > 86400) continue;

        const target = doc(db, 'rankingEntries', legacyDocumentId(entry, index));
        const existing = await getDoc(target);
        if (existing.exists()) continue;

        await setDoc(target, {
          name,
          score,
          createdAt: serverTimestamp(),
          ownerUid
        });
      }
    }
  };

  dispatch('ranking-store-ready', store);
}
