import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VaultGate from './VaultGate.jsx'
import { store } from './data/index.js'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <VaultGate store={store}>
      <App />
    </VaultGate>
  </StrictMode>,
)
