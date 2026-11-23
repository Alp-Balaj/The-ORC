# general / queue-fix-clear

- **Layout bug**: the "All leads are done" ready band in `App.tsx` was a third grid child with no column span, so it took the sidebar's cell and shifted sidebar/main/right panel one cell along (sidebar squeezed to the implicit auto row, ~15px tall). Fix: band spans all columns and the grid gets an `auto` second row while it shows. The same cause explains the oddly sized mission tree.
- **Clear queue**: `Queues.clear(root, 'done'|'all')` (never drops running items), IPC `queue:clear`, preload `queueClear`, buttons "Clear done (n)" and "Clear all" with inline Yes/No confirm in `QueuePanel`. Auto-clear not added.
