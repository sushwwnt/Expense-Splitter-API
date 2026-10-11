import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  getUsers,
  createUser,
  getGroups,
  createGroup,
  addGroupMember,
  removeGroupMember,
  getGroupBalances,
  getGroupExpenses,
  addExpense,
  settleUp,
} from './api';
import type { User, Group, Balance, Expense, NewExpense, SplitType } from './api';
import { Plus, UserPlus } from 'lucide-react';

type Dialog = 'user' | 'group' | 'expense' | null;
type Party = { id: number; name: string; paise: number };

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

const fontFamily = "'Geist', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black';

const btnPrimary = `inline-flex h-10 items-center justify-center gap-2 rounded-md bg-black px-4 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;

const btnSecondary = `inline-flex h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;

const inputClass =
  'h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black';

const smallInputClass =
  'h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black disabled:bg-zinc-100 disabled:text-zinc-500';

const labelClass = 'mb-1.5 block text-sm font-medium text-zinc-700';

const checkboxClass = 'h-4 w-4 shrink-0 rounded border-zinc-300 accent-black';

// The API can answer with a plain string or a validation object, so only show strings.
const getErrorMessage = (err: unknown, fallback: string): string => {
  const apiError = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  return typeof apiError === 'string' ? apiError : fallback;
};

const toNumber = (value: string | undefined) => {
  const n = parseFloat(value ?? '');
  return Number.isFinite(n) ? n : 0;
};

// Same rule as the server: leftover paise go to the lowest user ids first
function equalShares(totalPaise: number, ids: number[]): Map<number, number> {
  const sorted = [...ids].sort((a, b) => a - b);
  const result = new Map<number, number>();
  if (sorted.length === 0) return result;
  const base = Math.floor(totalPaise / sorted.length);
  const extra = totalPaise - base * sorted.length;
  sorted.forEach((id, index) => result.set(id, base + (index < extra ? 1 : 0)));
  return result;
}

const splitLabel = (expense: Expense) => {
  const count = expense.splits.length;
  const people = `${count} ${count === 1 ? 'person' : 'people'}`;
  if (expense.split_type === 'EXACT') return `Exact amounts for ${people}`;
  if (expense.split_type === 'PERCENT') return `Percentages for ${people}`;
  return `Equal split between ${people}`;
};

const splitOptions: { value: SplitType; label: string }[] = [
  { value: 'EQUAL', label: 'Equally' },
  { value: 'EXACT', label: 'Exact amounts' },
  { value: 'PERCENT', label: 'Percentages' },
];

function Modal({
  title,
  onClose,
  wide,
  children,
}: {
  title: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[90vh] w-full overflow-y-auto rounded-lg bg-white p-6 shadow-xl ${wide ? 'max-w-xl' : 'max-w-md'}`}
        onMouseDown={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add expense dialog: several payers, equal / exact / percentage split
// ---------------------------------------------------------------------------

function ExpenseDialog({
  members,
  onClose,
  onSubmit,
}: {
  members: Balance[];
  onClose: () => void;
  onSubmit: (payload: NewExpense) => Promise<string | null>;
}) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  // A person is a payer when their id is a key here. The value is what they paid (text from the input).
  const [paid, setPaid] = useState<Record<number, string>>(() =>
    members.length > 0 ? { [members[0].user_id]: '' } : {}
  );
  const [splitType, setSplitType] = useState<SplitType>('EQUAL');
  // A person is in the split when their id is a key here. The value is their amount or percent.
  const [included, setIncluded] = useState<Record<number, string>>(() =>
    Object.fromEntries(members.map(m => [m.user_id, '']))
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const totalPaise = Math.max(0, Math.round(toNumber(amount) * 100));
  const payerIds = members.map(m => m.user_id).filter(id => id in paid);
  const splitIds = members.map(m => m.user_id).filter(id => id in included);
  const onlyOnePayer = payerIds.length === 1;

  const paidPaise = payerIds.reduce((sum, id) => sum + Math.round(toNumber(paid[id]) * 100), 0);
  const assignedPaise = splitIds.reduce((sum, id) => sum + Math.round(toNumber(included[id]) * 100), 0);
  const equalPreview = equalShares(totalPaise, splitIds);

  const togglePayer = (id: number) =>
    setPaid(prev => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = '';
      return next;
    });

  const toggleIncluded = (id: number) =>
    setIncluded(prev => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = '';
      return next;
    });

  const buildPayload = (): NewExpense | string => {
    if (!description.trim()) return 'Add a description.';
    if (totalPaise <= 0) return 'Enter an amount greater than zero.';
    if (payerIds.length === 0) return 'Choose who paid.';

    let payers: NewExpense['payers'];
    if (onlyOnePayer) {
      payers = [{ user_id: payerIds[0], amount: totalPaise / 100 }];
    } else {
      payers = payerIds.map(id => ({ user_id: id, amount: toNumber(paid[id]) }));
      if (payers.some(p => p.amount <= 0)) return 'Enter an amount for everyone who paid.';
      if (paidPaise !== totalPaise) {
        return `Payer amounts add up to ${inr.format(paidPaise / 100)} but the total is ${inr.format(totalPaise / 100)}.`;
      }
    }

    if (splitIds.length === 0) return 'Choose at least one person to split with.';

    let splits: NewExpense['splits'];
    if (splitType === 'EQUAL') {
      splits = splitIds.map(id => ({ user_id: id }));
    } else {
      splits = splitIds.map(id => ({ user_id: id, value: toNumber(included[id]) }));
      if (splits.some(s => !s.value || s.value <= 0)) return 'Enter a value for everyone in the split.';
      if (splitType === 'EXACT' && assignedPaise !== totalPaise) {
        return `Split amounts add up to ${inr.format(assignedPaise / 100)} but the total is ${inr.format(totalPaise / 100)}.`;
      }
      if (splitType === 'PERCENT' && assignedPaise !== 10000) {
        return `Percentages add up to ${(assignedPaise / 100).toFixed(2)}% but must add up to 100%.`;
      }
    }

    return { description: description.trim(), amount: totalPaise / 100, split_type: splitType, payers, splits };
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const payload = buildPayload();
    if (typeof payload === 'string') {
      setError(payload);
      return;
    }
    setSubmitting(true);
    setError('');
    const message = await onSubmit(payload);
    if (message) setError(message);
    setSubmitting(false);
  };

  const matched = (a: number, b: number) => b > 0 && a === b;

  return (
    <Modal title="Add expense" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="mt-5 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="expense-desc" className={labelClass}>Description</label>
            <input
              id="expense-desc"
              type="text"
              autoFocus
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              className={inputClass}
              placeholder="Dinner at the beach shack"
            />
          </div>
          <div>
            <label htmlFor="expense-amount" className={labelClass}>Total amount</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">₹</span>
              <input
                id="expense-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
                className={`${inputClass} pl-7 tabular-nums`}
                placeholder="1500"
              />
            </div>
          </div>
        </div>

        <fieldset>
          <legend className={labelClass}>Who paid</legend>
          <div className="divide-y divide-zinc-100 rounded-md border border-zinc-300">
            {members.map(m => {
              const selected = m.user_id in paid;
              return (
                <div key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => togglePayer(m.user_id)}
                      className={checkboxClass}
                    />
                    <span className="truncate text-zinc-900">{m.name}</span>
                  </label>
                  {selected && (
                    <div className="relative w-32 shrink-0">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        aria-label={`Amount paid by ${m.name}`}
                        value={onlyOnePayer ? amount : paid[m.user_id]}
                        disabled={onlyOnePayer}
                        onChange={e => setPaid(prev => ({ ...prev, [m.user_id]: e.target.value }))}
                        className={`${smallInputClass} pl-7 tabular-nums`}
                        placeholder="0"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className={`mt-1.5 text-xs ${payerIds.length > 1 && matched(paidPaise, totalPaise) ? 'text-green-700' : 'text-zinc-500'}`}>
            {payerIds.length === 0
              ? 'Choose at least one person.'
              : onlyOnePayer
                ? 'One person paid the full amount. Tick more people to share the payment.'
                : `Paid ${inr.format(paidPaise / 100)} of ${inr.format(totalPaise / 100)}`}
          </p>
        </fieldset>

        <fieldset>
          <legend className={labelClass}>How to split</legend>
          <div role="radiogroup" aria-label="Split type" className="grid grid-cols-3 overflow-hidden rounded-md border border-zinc-300">
            {splitOptions.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={splitType === option.value}
                onClick={() => setSplitType(option.value)}
                className={`h-10 text-sm font-medium transition-colors ${focusRing} ${index > 0 ? 'border-l border-zinc-300' : ''} ${
                  splitType === option.value ? 'bg-black text-white' : 'bg-white text-zinc-700 hover:bg-zinc-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-3 divide-y divide-zinc-100 rounded-md border border-zinc-300">
            {members.map(m => {
              const selected = m.user_id in included;
              return (
                <div key={m.user_id} className="flex items-center gap-3 px-3 py-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleIncluded(m.user_id)}
                      className={checkboxClass}
                    />
                    <span className="truncate text-zinc-900">{m.name}</span>
                  </label>
                  {selected && splitType === 'EQUAL' && (
                    <span className="shrink-0 text-sm tabular-nums text-zinc-600">
                      {totalPaise > 0 ? inr.format((equalPreview.get(m.user_id) ?? 0) / 100) : ''}
                    </span>
                  )}
                  {selected && splitType === 'EXACT' && (
                    <div className="relative w-32 shrink-0">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        aria-label={`Amount for ${m.name}`}
                        value={included[m.user_id]}
                        onChange={e => setIncluded(prev => ({ ...prev, [m.user_id]: e.target.value }))}
                        className={`${smallInputClass} pl-7 tabular-nums`}
                        placeholder="0"
                      />
                    </div>
                  )}
                  {selected && splitType === 'PERCENT' && (
                    <div className="relative w-32 shrink-0">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        aria-label={`Percent for ${m.name}`}
                        value={included[m.user_id]}
                        onChange={e => setIncluded(prev => ({ ...prev, [m.user_id]: e.target.value }))}
                        className={`${smallInputClass} pr-7 tabular-nums`}
                        placeholder="0"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500">%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <p
            className={`mt-1.5 text-xs ${
              (splitType === 'EXACT' && matched(assignedPaise, totalPaise)) || (splitType === 'PERCENT' && assignedPaise === 10000)
                ? 'text-green-700'
                : 'text-zinc-500'
            }`}
          >
            {splitIds.length === 0
              ? 'Choose at least one person.'
              : splitType === 'EQUAL'
                ? `Split equally between ${splitIds.length} ${splitIds.length === 1 ? 'person' : 'people'}.`
                : splitType === 'EXACT'
                  ? `Assigned ${inr.format(assignedPaise / 100)} of ${inr.format(totalPaise / 100)}`
                  : `Assigned ${(assignedPaise / 100).toFixed(2)}% of 100%`}
          </p>
        </fieldset>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={onClose} className={btnSecondary}>Cancel</button>
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? 'Saving' : 'Add expense'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  const [dialog, setDialog] = useState<Dialog>(null);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);

  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [groupCreatorId, setGroupCreatorId] = useState<number>(1);
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<number[]>([]);

  const [memberToAdd, setMemberToAdd] = useState('');
  const [memberError, setMemberError] = useState('');
  const [memberBusy, setMemberBusy] = useState(false);

  // Remembers which group is on screen so a slow response for a previous group is ignored
  const activeGroupId = useRef<number | null>(null);

  const openDialog = (next: Exclude<Dialog, null>) => {
    setFormError('');
    if (next === 'group') setNewGroupMemberIds([]);
    setDialog(next);
  };

  const closeDialog = () => {
    setDialog(null);
    setFormError('');
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    activeGroupId.current = selectedGroup ? selectedGroup.id : null;
    setMemberError('');
    setMemberToAdd('');
    if (selectedGroup) {
      loadGroupData(selectedGroup.id);
    } else {
      setBalances([]);
      setExpenses([]);
    }
  }, [selectedGroup]);

  const loadInitialData = async () => {
    try {
      const usersRes = await getUsers();
      setUsers(usersRes.data);
      if (usersRes.data.length > 0) {
        setGroupCreatorId(prev => (usersRes.data.some(u => u.id === prev) ? prev : usersRes.data[0].id));
      }

      const groupsRes = await getGroups().catch(() => ({ data: [] as Group[] }));
      const groupList: Group[] = groupsRes.data || [];
      setGroups(groupList);

      // Keep the current selection if it still exists, otherwise fall back to the first group
      setSelectedGroup(prev => {
        if (prev) {
          const stillThere = groupList.find(g => g.id === prev.id);
          if (stillThere) return stillThere;
        }
        return groupList.length > 0 ? groupList[0] : null;
      });
      setNotice('');
    } catch (err) {
      console.error('Error loading data:', err);
      setNotice('Could not load data. Check that the API is running on http://localhost:3000.');
    }
  };

  const loadGroupData = async (groupId: number) => {
    try {
      const [balancesRes, expensesRes] = await Promise.all([getGroupBalances(groupId), getGroupExpenses(groupId)]);
      if (activeGroupId.current !== groupId) return;
      setBalances(balancesRes.data.balances);
      setExpenses(expensesRes.data.expenses);
    } catch (err) {
      console.error('Error loading group:', err);
      setNotice('Could not load this group. Try again.');
    }
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      await createUser({ name: newUserName.trim(), email: newUserEmail.trim() });
      setNewUserName('');
      setNewUserEmail('');
      closeDialog();
      await loadInitialData();
    } catch (err) {
      setFormError(getErrorMessage(err, 'Could not add this person. Check the details and try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleNewGroupMember = (id: number) =>
    setNewGroupMemberIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  const handleCreateGroup = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');
    try {
      const res = await createGroup({
        name: newGroupName.trim(),
        description: newGroupDesc.trim() || undefined,
        created_by: Number(groupCreatorId),
        member_ids: newGroupMemberIds.filter(id => id !== groupCreatorId),
      });
      setNewGroupName('');
      setNewGroupDesc('');
      closeDialog();
      await loadInitialData();
      if (res.data.group) {
        setSelectedGroup(res.data.group);
      }
    } catch (err) {
      setFormError(getErrorMessage(err, 'Could not create the group. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  // Returns an error message to show inside the dialog, or null when it worked
  const handleAddExpense = async (payload: NewExpense): Promise<string | null> => {
    if (!selectedGroup) return 'No group is selected.';
    try {
      await addExpense(selectedGroup.id, payload);
      closeDialog();
      await loadGroupData(selectedGroup.id);
      return null;
    } catch (err) {
      return getErrorMessage(err, 'Could not add the expense. Try again.');
    }
  };

  const handleAddMember = async () => {
    if (!selectedGroup || !memberToAdd) return;
    setMemberBusy(true);
    setMemberError('');
    try {
      await addGroupMember(selectedGroup.id, Number(memberToAdd));
      setMemberToAdd('');
      await loadGroupData(selectedGroup.id);
    } catch (err) {
      setMemberError(getErrorMessage(err, 'Could not add this person to the group.'));
    } finally {
      setMemberBusy(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!selectedGroup) return;
    setMemberBusy(true);
    setMemberError('');
    try {
      await removeGroupMember(selectedGroup.id, userId);
      await loadGroupData(selectedGroup.id);
    } catch (err) {
      setMemberError(getErrorMessage(err, 'Could not remove this person.'));
    } finally {
      setMemberBusy(false);
    }
  };

  const handleSettle = async (fromUser: number, toUser: number, amount: number, key: string) => {
    if (!selectedGroup) return;
    setSettlingKey(key);
    try {
      await settleUp(selectedGroup.id, {
        from_user: fromUser,
        to_user: toUser,
        amount,
      });
      await loadGroupData(selectedGroup.id);
    } catch (err) {
      setNotice(getErrorMessage(err, 'Could not record the payment. Try again.'));
    } finally {
      setSettlingKey(null);
    }
  };

  // People who exist but are not in the selected group yet
  const availableUsers = users.filter(u => !balances.some(b => b.user_id === u.id));

  // Turns the net balances into a short list of "who pays whom" payments
  const suggestions = useMemo(() => {
    const debtors: Party[] = balances
      .filter(b => b.net_balance < 0)
      .map(b => ({ id: b.user_id, name: b.name, paise: Math.round(Math.abs(b.net_balance) * 100) }))
      .sort((a, b) => b.paise - a.paise);
    const creditors: Party[] = balances
      .filter(b => b.net_balance > 0)
      .map(b => ({ id: b.user_id, name: b.name, paise: Math.round(b.net_balance * 100) }))
      .sort((a, b) => b.paise - a.paise);

    const result: { from: Party; to: Party; amount: number }[] = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].paise, creditors[j].paise);
      result.push({ from: { ...debtors[i] }, to: { ...creditors[j] }, amount: pay / 100 });
      debtors[i].paise -= pay;
      creditors[j].paise -= pay;
      if (debtors[i].paise === 0) i++;
      if (creditors[j].paise === 0) j++;
    }
    return result;
  }, [balances]);

  return (
    <div className="min-h-screen bg-zinc-100 text-zinc-900 md:flex md:h-screen" style={{ fontFamily }}>
      {/* Sidebar */}
      <aside className="flex flex-col bg-black text-zinc-300 md:h-screen md:w-72 md:shrink-0">
        <div className="px-5 pb-3 pt-6">
          <span className="text-[15px] font-semibold tracking-tight text-white">Expense Splitter</span>
        </div>

        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-sm font-medium text-zinc-500">Groups</h2>
          <button
            onClick={() => openDialog('group')}
            disabled={users.length === 0}
            aria-label="Create group"
            title={users.length === 0 ? 'Add a person first' : 'Create group'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <nav className="max-h-56 flex-1 overflow-y-auto px-3 pb-3 md:max-h-none" aria-label="Groups">
          {groups.length === 0 ? (
            <p className="px-2 py-3 text-sm text-zinc-500">No groups yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {groups.map(g => (
                <li key={g.id}>
                  <button
                    onClick={() => setSelectedGroup(g)}
                    aria-current={selectedGroup?.id === g.id ? 'true' : undefined}
                    className={`w-full truncate rounded-md px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                      selectedGroup?.id === g.id
                        ? 'bg-white text-black'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-white'
                    }`}
                  >
                    {g.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="border-t border-zinc-900 p-3">
          <button
            onClick={() => openDialog('user')}
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-900 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <span className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Add person
            </span>
            <span className="text-xs text-zinc-500">{users.length} {users.length === 1 ? 'person' : 'people'}</span>
          </button>
        </div>
      </aside>

      {/* Workspace */}
      <main className="flex-1 md:overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8 md:px-10 md:py-10">
          {notice && (
            <p role="alert" className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {notice}
            </p>
          )}

          {selectedGroup ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-900">{selectedGroup.name}</h1>
                  {selectedGroup.description && (
                    <p className="mt-1 text-sm text-zinc-600">{selectedGroup.description}</p>
                  )}
                  <p className="mt-1 text-sm text-zinc-500">
                    {balances.length} {balances.length === 1 ? 'member' : 'members'}
                  </p>
                </div>
                <button onClick={() => openDialog('expense')} disabled={balances.length === 0} className={btnPrimary}>
                  <Plus className="h-4 w-4" />
                  Add expense
                </button>
              </div>

              <section className="mt-8" aria-labelledby="balances-heading">
                <h2 id="balances-heading" className="text-base font-semibold text-zinc-900">
                  Balances
                </h2>
                <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  {balances.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-zinc-500">This group has no members yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500">
                          <th className="px-5 py-3 font-medium">Member</th>
                          <th className="hidden px-5 py-3 text-right font-medium sm:table-cell">Paid</th>
                          <th className="hidden px-5 py-3 text-right font-medium sm:table-cell">Share</th>
                          <th className="px-5 py-3 text-right font-medium">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {balances.map(b => (
                          <tr key={b.user_id}>
                            <td className="px-5 py-3.5 font-medium text-zinc-900">{b.name}</td>
                            <td className="hidden px-5 py-3.5 text-right tabular-nums text-zinc-600 sm:table-cell">
                              {inr.format(b.total_paid)}
                            </td>
                            <td className="hidden px-5 py-3.5 text-right tabular-nums text-zinc-600 sm:table-cell">
                              {inr.format(b.total_owed)}
                            </td>
                            <td className="px-5 py-3.5 text-right tabular-nums">
                              {b.net_balance > 0 ? (
                                <span className="font-medium text-green-700">Gets back {inr.format(b.net_balance)}</span>
                              ) : b.net_balance < 0 ? (
                                <span className="font-medium text-red-700">Owes {inr.format(Math.abs(b.net_balance))}</span>
                              ) : (
                                <span className="text-zinc-500">Settled</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              {balances.length > 0 && (
                <section className="mt-8" aria-labelledby="settle-heading">
                  <h2 id="settle-heading" className="text-base font-semibold text-zinc-900">
                    Settle up
                  </h2>
                  <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                    {suggestions.length === 0 ? (
                      <p className="px-5 py-6 text-sm text-zinc-500">Everyone is settled up.</p>
                    ) : (
                      <ul className="divide-y divide-zinc-100">
                        {suggestions.map(s => {
                          const key = `${s.from.id}-${s.to.id}`;
                          return (
                            <li key={key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                              <p className="text-sm text-zinc-600">
                                <span className="font-medium text-zinc-900">{s.from.name}</span> pays{' '}
                                <span className="font-medium text-zinc-900">{s.to.name}</span>{' '}
                                <span className="font-medium tabular-nums text-zinc-900">{inr.format(s.amount)}</span>
                              </p>
                              <button
                                className={btnSecondary}
                                disabled={settlingKey === key}
                                onClick={() => handleSettle(s.from.id, s.to.id, s.amount, key)}
                              >
                                {settlingKey === key ? 'Recording' : 'Record payment'}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </section>
              )}

              <section className="mt-8" aria-labelledby="expenses-heading">
                <h2 id="expenses-heading" className="text-base font-semibold text-zinc-900">
                  Expenses
                </h2>
                <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  {expenses.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-zinc-500">No expenses recorded yet.</p>
                  ) : (
                    <ul className="divide-y divide-zinc-100">
                      {expenses.map(expense => (
                        <li key={expense.id} className="flex items-start justify-between gap-4 px-5 py-4">
                          <div className="min-w-0">
                            <p className="font-medium text-zinc-900">{expense.description}</p>
                            <p className="mt-0.5 text-sm text-zinc-600">
                              Paid by {expense.payers.map(p => `${p.name} ${inr.format(p.amount)}`).join(', ')}
                            </p>
                            <p className="mt-0.5 text-xs text-zinc-500">
                              {splitLabel(expense)}, {new Date(expense.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </p>
                          </div>
                          <p className="shrink-0 font-medium tabular-nums text-zinc-900">{inr.format(expense.amount)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section className="mt-8" aria-labelledby="members-heading">
                <h2 id="members-heading" className="text-base font-semibold text-zinc-900">
                  Members
                </h2>
                <div className="mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                  <ul className="divide-y divide-zinc-100">
                    {balances.map(b => (
                      <li key={b.user_id} className="flex items-center justify-between gap-4 px-5 py-3">
                        <span className="text-sm font-medium text-zinc-900">{b.name}</span>
                        <button
                          onClick={() => handleRemoveMember(b.user_id)}
                          disabled={memberBusy}
                          className={`rounded-md px-2 py-1 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-red-700 disabled:opacity-40 ${focusRing}`}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="border-t border-zinc-200 bg-zinc-50 px-5 py-4">
                    {availableUsers.length === 0 ? (
                      <p className="text-sm text-zinc-500">
                        {users.length <= balances.length
                          ? 'Everyone you have added is already in this group. Use Add person in the sidebar to add someone new.'
                          : 'Everyone is already in this group.'}
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-3">
                        <select
                          value={memberToAdd}
                          onChange={e => setMemberToAdd(e.target.value)}
                          aria-label="Choose a person to add to this group"
                          className={`${inputClass} sm:w-64`}
                        >
                          <option value="">Choose a person</option>
                          {availableUsers.map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleAddMember}
                          disabled={!memberToAdd || memberBusy}
                          className={btnSecondary}
                        >
                          Add to group
                        </button>
                      </div>
                    )}
                    {memberError && <p role="alert" className="mt-2 text-sm text-red-700">{memberError}</p>}
                  </div>
                </div>
              </section>
            </>
          ) : (
            <div className="max-w-md pt-4">
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Create your first group</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {users.length === 0
                  ? 'Add the people who share costs first. Then create a group and record what each person paid.'
                  : 'A group holds the people who share costs. Create one, then record what each person paid.'}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={() => openDialog('user')} className={btnSecondary}>
                  <UserPlus className="h-4 w-4" />
                  Add person
                </button>
                <button onClick={() => openDialog('group')} disabled={users.length === 0} className={btnPrimary}>
                  <Plus className="h-4 w-4" />
                  Create group
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Add person */}
      {dialog === 'user' && (
        <Modal title="Add person" onClose={closeDialog}>
          <form onSubmit={handleCreateUser} className="mt-5 space-y-4">
            <div>
              <label htmlFor="user-name" className={labelClass}>Name</label>
              <input
                id="user-name"
                type="text"
                autoFocus
                value={newUserName}
                onChange={e => setNewUserName(e.target.value)}
                required
                className={inputClass}
                placeholder="Rahul Sharma"
              />
            </div>
            <div>
              <label htmlFor="user-email" className={labelClass}>Email</label>
              <input
                id="user-email"
                type="email"
                value={newUserEmail}
                onChange={e => setNewUserEmail(e.target.value)}
                required
                className={inputClass}
                placeholder="rahul@example.com"
              />
            </div>
            {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeDialog} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={submitting} className={btnPrimary}>
                {submitting ? 'Saving' : 'Save person'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Create group */}
      {dialog === 'group' && (
        <Modal title="Create group" onClose={closeDialog}>
          <form onSubmit={handleCreateGroup} className="mt-5 space-y-4">
            <div>
              <label htmlFor="group-name" className={labelClass}>Group name</label>
              <input
                id="group-name"
                type="text"
                autoFocus
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                required
                className={inputClass}
                placeholder="Goa trip 2026"
              />
            </div>
            <div>
              <label htmlFor="group-desc" className={labelClass}>Description (optional)</label>
              <input
                id="group-desc"
                type="text"
                value={newGroupDesc}
                onChange={e => setNewGroupDesc(e.target.value)}
                className={inputClass}
                placeholder="Hotel, food and fuel"
              />
            </div>
            <div>
              <label htmlFor="group-creator" className={labelClass}>Created by</label>
              <select
                id="group-creator"
                value={groupCreatorId}
                onChange={e => setGroupCreatorId(Number(e.target.value))}
                className={inputClass}
              >
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend className={labelClass}>Members</legend>
              <div className="max-h-44 divide-y divide-zinc-100 overflow-y-auto rounded-md border border-zinc-300">
                {users.map(u => {
                  const isCreator = u.id === groupCreatorId;
                  return (
                    <label key={u.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={isCreator || newGroupMemberIds.includes(u.id)}
                        disabled={isCreator}
                        onChange={() => toggleNewGroupMember(u.id)}
                        className={checkboxClass}
                      />
                      <span className="text-zinc-900">{u.name}</span>
                      {isCreator && <span className="ml-auto text-xs text-zinc-500">Creator</span>}
                    </label>
                  );
                })}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">You can add or remove members later from the group page.</p>
            </fieldset>
            {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={closeDialog} className={btnSecondary}>Cancel</button>
              <button type="submit" disabled={submitting} className={btnPrimary}>
                {submitting ? 'Creating' : 'Create group'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add expense */}
      {dialog === 'expense' && <ExpenseDialog members={balances} onClose={closeDialog} onSubmit={handleAddExpense} />}
    </div>
  );
}