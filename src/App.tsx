import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import './App.scss';
import { ConsolePage } from './pages/ConsolePage';
import { persistor, store } from './store/store';

function App() {
  return (
    <div data-component="App">
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <ConsolePage />
        </PersistGate>
      </Provider>
    </div>
  );
}

export default App;
