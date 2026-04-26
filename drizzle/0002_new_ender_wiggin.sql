CREATE TABLE `system_lock` (
	`name` text PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`start_time_ticks` integer NOT NULL,
	`acquired_at` text NOT NULL
);
