import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Header, InventoryItem, OutageSimulationModal } from '../../../src/App.jsx';
import { simulateOutage } from '../../../shared/outage.js';
import { settingsSchema } from '../../../shared/schema.js';

// Renders the real, shared components straight from src/App.jsx (no mocks/copies) so
// Playwright specs under tests/e2e/specs exercise the exact accessibility behavior
// (accessible names, focus trap/restoration, live-region announcements, keyboard
// activation) that ships in the app, without needing a database-backed login.
function Harness() {
  const [syncState, setSyncState] = useState({ isSyncing: false, online: true, pendingSync: 0, lastSyncedAt: Date.now(), error: null });
  const [editCount, setEditCount] = useState(0);
  const [buyCount, setBuyCount] = useState(0);
  const [selected, setSelected] = useState(false);
  const [showSimulation, setShowSimulation] = useState(false);

  const item = { id: 'water-1', name: 'Water Jug', quantity: 4, unit: 'gal', category: 'Water' };
  // A fixed scenario so the dialog's accessible name and contents are deterministic.
  const settings = settingsSchema.parse({});
  const simulation = simulateOutage({
    inventory: [item, { id: 'battery-1', name: 'Battery', category: 'Power', quantity: 1, capacityPerUnit: 2 }],
    appliances: [{ id: 'fridge', name: 'Fridge', watts: 150, hours: 24, active: true, priority: 'normal' }],
    plan: null,
  }, settings, { hours: 72 });

  return (
    <div>
      <Header
        isSyncing={syncState.isSyncing}
        online={syncState.online}
        pendingSync={syncState.pendingSync}
        lastSyncedAt={syncState.lastSyncedAt}
        error={syncState.error}
        onSyncClick={() => {}}
        onDownload={() => {}}
      />
      <main>
        <h2>Accessibility test harness</h2>
        <section>
          <h3>Sync state controls</h3>
          <button data-testid="set-syncing" onClick={() => setSyncState(s => ({ ...s, isSyncing: true, error: null, pendingSync: 0 }))}>Simulate syncing</button>
          <button data-testid="set-queued" onClick={() => setSyncState(s => ({ ...s, isSyncing: false, error: null, pendingSync: 3 }))}>Simulate queued</button>
          <button data-testid="set-offline" onClick={() => setSyncState(s => ({ ...s, online: false, error: null }))}>Simulate offline</button>
          <button data-testid="set-error" onClick={() => setSyncState(s => ({ ...s, online: true, isSyncing: false, error: 'Save failed.' }))}>Simulate error</button>
          <button data-testid="set-synced" onClick={() => setSyncState({ isSyncing: false, online: true, pendingSync: 0, lastSyncedAt: Date.now() - 15000, error: null })}>Simulate synced</button>
        </section>

        <section>
          <h3>Inventory row</h3>
          <InventoryItem
            item={item}
            onClick={() => setEditCount(c => c + 1)}
            onBuy={() => setBuyCount(c => c + 1)}
            selected={selected}
            onSelect={value => setSelected(value)}
          />
          <p data-testid="edit-count">{editCount}</p>
          <p data-testid="buy-count">{buyCount}</p>
          <p data-testid="selected-state">{String(selected)}</p>
        </section>

        <section>
          <h3>Outage simulation modal</h3>
          <button data-testid="open-simulation-modal" onClick={() => setShowSimulation(true)}>Open Simulation</button>
          {showSimulation && (
            <OutageSimulationModal
              result={simulation}
              settings={settings}
              onClose={() => setShowSimulation(false)}
            />
          )}
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
