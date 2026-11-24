import { createElement as h, type ReactNode } from 'react';
import { registerPairs } from '../contrast/pairs.ts';
import { frame, isColumns, optionLetter, optionPicture, richText } from './parts.ts';
import { layoutPairs } from './pairs.ts';
import type { LayoutProps } from './types.ts';

registerPairs('question', ({ size }) =>
  layoutPairs({ kicker: true, lead: 'question', options: true }, size),
);

/** One option's letter, as the span the CSS styles: a letter in the primary, or white on a scrim over a picture. */
const letter = (props: LayoutProps<'question'>, index: number): ReactNode =>
  h('span', { className: 'option-mark' }, optionLetter(props.post, index));

/**
 * Options that are all pictures: one box of tiles, in the image box so the frame, corner and full-bleed switches
 * style it. Each tile has its letter on a scrim. An image that isn't an asset leaves no tile, and a warning.
 */
function pictureOptions(props: LayoutProps<'question'>): ReactNode {
  const tiles = props.slide.options.flatMap((option, index) => {
    const picture =
      'image' in option ? optionPicture(props, index, option.image.asset, 'photo') : null;
    return picture === null
      ? []
      : [h('li', { className: 'option-image' }, picture, letter(props, index))];
  });
  return tiles.length === 0 ? null : h('ul', { className: 'image-box option-images' }, ...tiles);
}

/**
 * Options that are text, or text and pictures: a list of rows, each a letter and then its words or a small picture.
 * They are plain rows, not buttons: the answers come in the comments (§07), where a reader writes the letter.
 */
function listOptions(props: LayoutProps<'question'>): ReactNode {
  const rows = props.slide.options.flatMap((option, index) => {
    const answer =
      'text' in option
        ? h('span', { className: 'option-text' }, ...richText(option.text))
        : optionPicture(props, index, option.image.asset, 'option-thumb');
    return answer === null ? [] : [h('li', { className: 'option' }, letter(props, index), answer)];
  });
  return h('ul', { className: 'options' }, ...rows);
}

/**
 * The `question` layout (§07: kicker, question, 2 to 4 options, text or image): a community question whose answers
 * come in the comments. Stacked, the kicker, the question and the options go one under another. On landscape (§08: two
 * columns) the kicker and question are the left column and the options the right: a list of rows, or, when every
 * option is a picture, the box of pictures. Every text is text the post gave, so it is escaped.
 */
export function QuestionLayout(props: LayoutProps<'question'>): ReactNode {
  const { slide, size } = props;
  const kicker = h('p', { className: 'kicker' }, ...richText(slide.kicker));
  const question = h('p', { className: 'question' }, ...richText(slide.question));
  const pictures = slide.options.every((option) => 'image' in option);
  const options = pictures ? pictureOptions(props) : listOptions(props);
  const { header, footer } = frame(props);

  const blocks = isColumns(size)
    ? [
        h('div', { className: 'col col-text' }, kicker, question),
        pictures ? options : h('div', { className: 'col col-detail' }, options),
      ]
    : [kicker, question, options];

  return h(
    'main',
    { className: 'slide layout-question' },
    header,
    h('div', { className: 'text-area' }, ...blocks),
    footer,
  );
}
