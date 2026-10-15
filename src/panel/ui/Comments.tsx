import type { ComponentChildren } from 'preact';
import type { Comment } from '../../shared/types';
import { personName, when } from '../detail';
import { initials } from '../format';
import { Markdown } from './Markdown';

/** The comment thread, oldest first, as the mockup reads: avatar, name and time, then the text. */
export function Comments({ comments, panel, now, composer }: { comments: Comment[]; panel: string | null; now: number; composer?: ComponentChildren }) {
  return (
    <div class="bd-cms">
      {comments.length === 0 && <p class="bd-none">No comments yet.</p>}
      {comments.map((c) => {
        const name = personName(c.author, panel);
        const mine = name === 'you (panel)';
        return (
          <article key={c.id} class="bd-cm" aria-label={`Comment by ${name}`}>
            <span class="bd-av" data-me={mine || undefined} data-none={c.author ? undefined : true} aria-hidden="true">
              {c.author ? initials(c.author) || '?' : '?'}
            </span>
            <div class="bd-cm-main">
              <div class="bd-cm-who">
                <b>{name}</b>
                <time dateTime={c.createdAt} title={c.createdAt}>
                  {when(c.createdAt, now)}
                </time>
              </div>
              <Markdown class="bd-cm-txt" text={c.text} />
            </div>
          </article>
        );
      })}
      {composer}
    </div>
  );
}
