import { bigint, check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const seatStatus = pgEnum('seat_status', ['available', 'confirmed']);
export const reservationStatus = pgEnum('reservation_status', ['confirmed', 'cancelled']);

export const shows = pgTable('shows', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  pricePaise: bigint('price_paise', { mode: 'number' }).notNull(),
  perUserLimit: integer('per_user_limit').notNull().default(4),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('shows_price_positive', sql`${table.pricePaise} > 0`),
  check('shows_per_user_limit_positive', sql`${table.perUserLimit} > 0`),
]);

export const reservations = pgTable('reservations', {
  id: uuid('id').defaultRandom().primaryKey(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'restrict' }),
  userId: text('user_id').notNull(),
  amountPaise: bigint('amount_paise', { mode: 'number' }).notNull(),
  status: reservationStatus('status').notNull().default('confirmed'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
}, (table) => [
  index('reservations_show_user_idx').on(table.showId, table.userId),
  check('reservations_amount_positive', sql`${table.amountPaise} > 0`),
  check('reservations_cancelled_at_consistent', sql`(${table.status} = 'confirmed' AND ${table.cancelledAt} IS NULL) OR (${table.status} = 'cancelled' AND ${table.cancelledAt} IS NOT NULL)`),
]);

export const seats = pgTable('seats', {
  id: uuid('id').defaultRandom().primaryKey(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  seatNumber: text('seat_number').notNull(),
  status: seatStatus('status').notNull().default('available'),
  reservationId: uuid('reservation_id').references(() => reservations.id, { onDelete: 'restrict' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('seats_show_seat_number_uq').on(table.showId, table.seatNumber),
  index('seats_show_status_idx').on(table.showId, table.status),
  check('seats_reservation_state_consistent', sql`(${table.status} = 'available' AND ${table.reservationId} IS NULL) OR (${table.status} = 'confirmed' AND ${table.reservationId} IS NOT NULL)`),
]);

export const reservationSeats = pgTable('reservation_seats', {
  reservationId: uuid('reservation_id').notNull().references(() => reservations.id, { onDelete: 'cascade' }),
  seatId: uuid('seat_id').notNull().references(() => seats.id, { onDelete: 'restrict' }),
}, (table) => [
  primaryKey({ columns: [table.reservationId, table.seatId] }),
]);

export const userShowInventory = pgTable('user_show_inventory', {
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  activeSeatCount: integer('active_seat_count').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.showId, table.userId] }),
  check('user_show_inventory_count_nonnegative', sql`${table.activeSeatCount} >= 0`),
]);

export const idempotencyKeys = pgTable('idempotency_keys', {
  userId: text('user_id').notNull(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  reservationId: uuid('reservation_id').references(() => reservations.id, { onDelete: 'restrict' }),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.userId, table.showId, table.key] }),
]);
