# Merge onto Main is serial

Implementation Agent sessions may run in parallel up to `max_concurrency`. Merging a Ticket branch into Main takes a lock on the Target `.git` (flock) so two merges never run at once.

Rejected: parallel merges onto Main; letting git sort out overlapping merges.
