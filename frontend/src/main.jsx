import {StrictMode} from "react"
import {createRoot} from "react-dom/client"
import App from "./App.jsx"
import "./index.css"
import { root } from "postcss/lib/postcss"

const rootElement = document.getElementById('app')
if (!rootElement){
    throw new Error('Target container "#app" not found in the DOM.')
}

createRoot(rootElement).render(
    <StrictMode>
        <App/>
    </StrictMode>
)