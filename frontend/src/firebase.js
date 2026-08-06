import { initializeApp } from 'firebase/app';

/* Firebase web config is not a secret — it's meant to ship inside the client
   bundle (same reasoning as a VAPID public key). Access control is enforced
   by Firebase Security Rules / API key restrictions in the Google Cloud
   console, not by hiding these values. */
const firebaseConfig = {
  apiKey: 'AIzaSyB3xG2mXeH54ri-4xs81qA2WXgeE8bS4CU',
  authDomain: 'soac-493719.firebaseapp.com',
  projectId: 'soac-493719',
  storageBucket: 'soac-493719.firebasestorage.app',
  messagingSenderId: '303465255574',
  appId: '1:303465255574:web:990c1230f7c5ab9643e8b7',
  measurementId: 'G-SJ2C69VC7G',
};

export const firebaseApp = initializeApp(firebaseConfig);
