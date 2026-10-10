import React, { useEffect, useState } from 'react';
import { getUsers, createUser, getGroups, createGroup, getGroupBalances, addExpense, settleUp } from './api';
import type { User, Group, Balance } from './api';
import { PlusCircle, Wallet, Receipt, ArrowRightLeft, UserPlus } from 'lucide-react';

export default function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [balances, setBalances] = useState<Balance[]>([]);

  // Modals & Form states
  const [showUserModal, setShowUserModal] = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);

  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [groupCreatorId, setGroupCreatorId] = useState<number>(1);

  // Expense form states
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expensePaidBy, setExpensePaidBy] = useState<number>(1);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedGroup) {
      loadBalances(selectedGroup.id);
    } else {
      setBalances([]);
    }
  }, [selectedGroup]);

  // Keep "Paid By" pointing at a user who is actually in the selected group
  useEffect(() => {
    if (balances.length > 0 && !balances.some(b => b.user_id === expensePaidBy)) {
      setExpensePaidBy(balances[0].user_id);
    }
  }, [balances, expensePaidBy]);

  const loadInitialData = async () => {
    try {
      const usersRes = await getUsers();
      setUsers(usersRes.data);
      if (usersRes.data.length > 0) {
        setGroupCreatorId(prev =>
          usersRes.data.some((u: User) => u.id === prev) ? prev : usersRes.data[0].id
        );
      }

      // Note: If /groups endpoint is not yet returning list directly, ensure backend handles it or handle gracefully
      const groupsRes = await getGroups().catch(() => ({ data: [] }));
      const groupList: Group[] = groupsRes.data || [];
      setGroups(groupList);

      // Keep the currently selected group if it still exists, otherwise fall back to the first one
      setSelectedGroup(prev => {
        if (prev) {
          const stillThere = groupList.find(g => g.id === prev.id);
          if (stillThere) return stillThere;
        }
        return groupList.length > 0 ? groupList[0] : null;
      });
    } catch (err) {
      console.error('Error loading data:', err);
    }
  };

  const loadBalances = async (groupId: number) => {
    try {
      const res = await getGroupBalances(groupId);
      setBalances(res.data.balances);
    } catch (err) {
      console.error('Error loading balances:', err);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createUser({ name: newUserName, email: newUserEmail });
      setNewUserName('');
      setNewUserEmail('');
      setShowUserModal(false);
      loadInitialData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create user');
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await createGroup({ name: newGroupName, description: newGroupDesc, created_by: Number(groupCreatorId) });
      setNewGroupName('');
      setNewGroupDesc('');
      setShowGroupModal(false);
      await loadInitialData();
      if (res.data.group) {
        setSelectedGroup(res.data.group);
      }
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create group');
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroup) return;

    if (balances.length === 0) {
      alert('This group has no members to split the expense with');
      return;
    }

    const amt = parseFloat(expenseAmount);
    if (isNaN(amt) || amt <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    // Split equally in paise (integers) so the shares always add up to the exact total.
    // Example: 100.00 among 3 people -> 33.34 + 33.33 + 33.33
    const totalPaise = Math.round(amt * 100);
    const basePaise = Math.floor(totalPaise / balances.length);
    const extraPaise = totalPaise - basePaise * balances.length;
    const splits = balances.map((b, index) => ({
      user_id: b.user_id,
      amount: (basePaise + (index < extraPaise ? 1 : 0)) / 100
    }));

    try {
      await addExpense(selectedGroup.id, {
        description: expenseDesc,
        amount: amt,
        paid_by: Number(expensePaidBy),
        splits
      });
      setExpenseDesc('');
      setExpenseAmount('');
      setShowExpenseModal(false);
      loadBalances(selectedGroup.id);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add expense');
    }
  };

  const handleSettle = async (fromUser: number, toUser: number, amount: number) => {
    if (!selectedGroup) return;
    try {
      await settleUp(selectedGroup.id, {
        from_user: fromUser,
        to_user: toUser,
        amount: amount
      });
      loadBalances(selectedGroup.id);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to settle');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex justify-between items-center shadow-md">
        <div className="flex items-center space-x-3">
          <Wallet className="w-8 h-8 text-emerald-400" />
          <h1 className="text-xl font-bold tracking-wide">Expense Splitter</h1>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => setShowUserModal(true)}
            className="flex items-center space-x-2 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            <UserPlus className="w-4 h-4 text-emerald-400" />
            <span>Add User</span>
          </button>
          <button
            onClick={() => setShowGroupModal(true)}
            className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-lg text-sm font-medium transition shadow-lg shadow-emerald-900/30"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Create Group</span>
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: Groups list */}
        <aside className="w-72 bg-slate-800/50 border-r border-slate-700 p-4 flex flex-col">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Your Groups</h2>
          <div className="space-y-1 overflow-y-auto flex-1">
            {groups.length === 0 ? (
              <p className="text-sm text-slate-500 px-2 py-4">No groups yet. Create one!</p>
            ) : (
              groups.map(g => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGroup(g)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                    selectedGroup?.id === g.id
                      ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                      : 'hover:bg-slate-700/50 text-slate-300'
                  }`}
                >
                  {g.name}
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 p-8 overflow-y-auto bg-slate-900">
          {selectedGroup ? (
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Group Header */}
              <div className="flex justify-between items-center bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-sm">
                <div>
                  <h2 className="text-2xl font-bold text-white">{selectedGroup.name}</h2>
                  {selectedGroup.description && <p className="text-sm text-slate-400 mt-1">{selectedGroup.description}</p>}
                </div>
                <button
                  onClick={() => setShowExpenseModal(true)}
                  className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 rounded-lg text-sm font-semibold transition shadow-lg shadow-emerald-900/30"
                >
                  <Receipt className="w-4 h-4" />
                  <span>Add Expense</span>
                </button>
              </div>

              {/* Balances Section */}
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-sm">
                <h3 className="text-lg font-semibold mb-4 text-emerald-400 flex items-center space-x-2">
                  <ArrowRightLeft className="w-5 h-5" />
                  <span>Member Balances</span>
                </h3>

                {balances.length === 0 ? (
                  <p className="text-sm text-slate-500">No members or balances found in this group.</p>
                ) : (
                  <div className="space-y-3">
                    {balances.map(b => (
                      <div key={b.user_id} className="flex justify-between items-center bg-slate-900/60 p-4 rounded-lg border border-slate-700/50">
                        <div>
                          <p className="font-semibold text-slate-200">{b.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Paid: ₹{b.total_paid} | Owed: ₹{b.total_owed}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                            b.net_balance > 0
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : b.net_balance < 0
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : 'bg-slate-700 text-slate-300'
                          }`}>
                            {b.net_balance > 0 ? `Gets back ₹${b.net_balance}` : b.net_balance < 0 ? `Owes ₹${Math.abs(b.net_balance)}` : 'Settled up'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2">
              <Wallet className="w-12 h-12 text-slate-600" />
              <p className="text-lg">Select a group or create a new one to get started.</p>
            </div>
          )}
        </main>
      </div>

      {/* MODALS */}
      {/* 1. Add User Modal */}
      {showUserModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">Add New User</h3>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Name</label>
                <input
                  type="text"
                  value={newUserName}
                  onChange={e => setNewUserName(e.target.value)}
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="e.g. Rahul Sharma"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Email</label>
                <input
                  type="email"
                  value={newUserEmail}
                  onChange={e => setNewUserEmail(e.target.value)}
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="rahul@example.com"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={() => setShowUserModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-lg text-sm font-semibold transition">Save User</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Create Group Modal */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">Create New Group</h3>
            <form onSubmit={handleCreateGroup} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Group Name</label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="e.g. Goa Trip 2026"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Description (Optional)</label>
                <input
                  type="text"
                  value={newGroupDesc}
                  onChange={e => setNewGroupDesc(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="Trip expenses split"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Created By (User)</label>
                <select
                  value={groupCreatorId}
                  onChange={e => setGroupCreatorId(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                >
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={() => setShowGroupModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-lg text-sm font-semibold transition">Create Group</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Add Expense Modal */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-700 shadow-xl">
            <h3 className="text-lg font-bold mb-4">Add Expense</h3>
            <form onSubmit={handleAddExpense} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Description</label>
                <input
                  type="text"
                  value={expenseDesc}
                  onChange={e => setExpenseDesc(e.target.value)}
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="e.g. Dinner at Beach Shack"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Total Amount (₹)</label>
                <input
                  type="number"
                  step="0.01"
                  value={expenseAmount}
                  onChange={e => setExpenseAmount(e.target.value)}
                  required
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  placeholder="1500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase mb-1">Paid By</label>
                <select
                  value={expensePaidBy}
                  onChange={e => setExpensePaidBy(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                >
                  {balances.map(b => (
                    <option key={b.user_id} value={b.user_id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={() => setShowExpenseModal(false)} className="px-4 py-2 text-sm text-slate-400 hover:text-white">Cancel</button>
                <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-lg text-sm font-semibold transition">Add Expense</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}