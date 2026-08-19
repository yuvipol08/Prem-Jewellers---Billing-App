import { Modal } from './Modal';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Billing',
    items: [
      ['F2', 'Start a new bill'],
      ['Ctrl / Cmd + S', 'Save the bill'],
      ['Ctrl / Cmd + Enter', 'Save and print'],
      ['Ctrl / Cmd + P', 'Print'],
      ['Ctrl / Cmd + Shift + P', 'Print preview'],
      ['Ctrl / Cmd + E', 'Save as PDF'],
      ['Ctrl / Cmd + W', 'Share on WhatsApp'],
      ['Alt + N', 'Add an item line'],
      ['Enter', 'Move down the same column'],
    ],
  },
  {
    title: 'Navigation',
    items: [
      ['Ctrl / Cmd + 1', 'Billing'],
      ['Ctrl / Cmd + 2', 'Customers'],
      ['Ctrl / Cmd + 3', 'Invoices'],
      ['Ctrl / Cmd + 4', 'Dashboard'],
      ['Ctrl / Cmd + 5', 'Backup & Settings'],
      ['F1', 'This help'],
      ['Esc', 'Close a dialog'],
    ],
  },
];

export function ShortcutsHelp({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Keyboard Shortcuts" onClose={onClose} wide>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26 }}>
        {GROUPS.map((group) => (
          <div key={group.title}>
            <div className="section-title">{group.title}</div>
            <table className="table">
              <tbody>
                {group.items.map(([keys, description]) => (
                  <tr key={keys}>
                    <td className="mono nowrap" style={{ width: 165 }}>
                      {keys}
                    </td>
                    <td>{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Modal>
  );
}
