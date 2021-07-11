const got = require('@/utils/got');
const cheerio = require('cheerio');

const fetchPageHtml = async (linkPath, cacheKey, cache) => {
    const url = `https://medium.com${linkPath}`;

    return cache.tryGet(cacheKey, async () => {
        const { data: html } = await got.get(url);
        return html;
    });
};

/*
const filterBigImage = async (description_el) => {
	const new_description = $(description_el).find('figure.paragraph-image').each(function(i, el) {
		const img = $(el).find('noscript img');
		$(el).children().first().replaceWith(img);
	});
	return new_description.html();
};*/

module.exports = async (ctx) => {
    const { id } = ctx.params;
    const pageId = encodeURIComponent(id);
    const linkPath = `/@${pageId}`;

    const html = await fetchPageHtml(linkPath, pageId, ctx.cache);
    const $ = cheerio.load(html);

    const titles = $('h1');

    const items = titles
        .map(function (i, el) {
            /*
		const test1 = $(el).parent('section').find('figure.paragraph-image').each(function(i, el) {
			console.log($(el).find('noscript img'));
		}).html();
		const new_description = $(el).parent('section').find('figure.paragraph-image').each(function(i, el) {
			const img = $(el).find('noscript img');
			if ( img.length > 0 ) {
				$(el).children().first().replaceWith(img);
				console.log($(el).children().first());
			} else {
				console.log($(el).find('noscript'));
			}
		}).html();
		*/
            const new_description = $(el).parent('section').html();
            return {
                title: $(el).text(),
                link: $(el).find('a').attr('href'),
                description: new_description,
            };
        })
        .toArray();

    ctx.state.data = {
        title: $('[aria-label="Author Homepage"]').text(),
        link: `https://medium.com/@${pageId}`,
        description: '',
        item: items.filter((item) => !!item),
    };
};
