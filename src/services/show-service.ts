import { pool } from '../db/client.js';
import { DomainError } from '../errors/domain-error.js';

export interface CreateShowInput {
  name: string;
  seats: string[];
  pricePaise: number;
  perUserLimit: number;
}

export async function createShow(input: CreateShowInput) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const showResult = await client.query<{
      id: string; name: string; price_paise: string; per_user_limit: number; created_at: Date;
    }>(
      `INSERT INTO shows(name, price_paise, per_user_limit)
       VALUES ($1, $2, $3)
       RETURNING id, name, price_paise, per_user_limit, created_at`,
      [input.name, input.pricePaise, input.perUserLimit],
    );
    const show = showResult.rows[0];
    if (!show) throw new Error('Show insert returned no row');

    await client.query(
      `INSERT INTO seats(show_id, seat_number)
       SELECT $1, unnest($2::text[])`,
      [show.id, input.seats],
    );
    await client.query('COMMIT');

    return {
      id: show.id,
      name: show.name,
      price_paise: Number(show.price_paise),
      per_user_limit: show.per_user_limit,
      seats: input.seats.map((seatNumber) => ({ seat_number: seatNumber, status: 'available' as const })),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function getShowState(showId: string) {
  const showResult = await pool.query<{ id: string; name: string; price_paise: string; per_user_limit: number }>(
    'SELECT id, name, price_paise, per_user_limit FROM shows WHERE id = $1',
    [showId],
  );
  const show = showResult.rows[0];
  if (!show) throw new DomainError('SHOW_NOT_FOUND', 404, 'Show not found');

  const seatsResult = await pool.query<{ seat_number: string; status: 'available' | 'confirmed' }>(
    'SELECT seat_number, status FROM seats WHERE show_id = $1 ORDER BY seat_number',
    [showId],
  );

  const available = seatsResult.rows.filter((seat) => seat.status === 'available').length;
  const confirmed = seatsResult.rows.length - available;

  return {
    id: show.id,
    name: show.name,
    price_paise: Number(show.price_paise),
    per_user_limit: show.per_user_limit,
    seats: seatsResult.rows,
    counts: { total: seatsResult.rows.length, available, held: 0, confirmed },
  };
}
