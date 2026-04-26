import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );
  return rss({
    title: 'Tricho — Blog',
    description: 'Zápisky o tom, co se v Tricho děje. Nové funkce, technické rozbory, příběhy zezdola.',
    site: context.site ?? 'https://tricho.app',
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/blog/${post.slug}`,
    })),
    customData: '<language>cs-CZ</language>',
  });
}
