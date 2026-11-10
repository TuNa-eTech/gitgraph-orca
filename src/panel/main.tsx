// Entry of the html panel. Runs in Orca's sandboxed frame: no network, no file system; it talks to
// Orca only through `window.orca`, and asks the worker for git data with `orca.plugin.request`.
import { render } from 'preact'
import { App } from './App'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html is missing #root')
render(<App />, root)
