const got = require('@/utils/got');
const logger = require('@/utils/logger');
const { parseDate } = require('@/utils/parse-date');
const cheerio = require('cheerio');

const fetchPageHtml = (linkPath, cacheKey, cache) => {
    const url = `https://mbasic.facebook.com${linkPath}`;

    return cache.tryGet(cacheKey, async () => {
        const { data: html } = await got.get(url);
        return html;
    });
};

const fetchPageHtml2 = async (linkPath, cacheKey, cache) => {
    const url = `https://mbasic.facebook.com${linkPath}`;

    const html = cache.get(cacheKey);
    if (!html) {
        const response = await got.get(url, {
            followRedirect: false,
            headers: {
                'Accept-Language': 'en'
            }
        });
        if (response.statusCode == 302) {
            return null;
        } else {
            return response.data;
        }
    }
};

const parseStoryPage = async (linkPath, cache) => {
    const { searchParams: q } = new URL('https://mbasic.facebook.com' + linkPath);
    const storyFbId = q.get('story_fbid');
    const storyId = q.get('id');
    const cacheKey = `story/${storyFbId}/${storyId}`;

    const html = await fetchPageHtml2(linkPath, cacheKey, cache);
    if (html === null) {
        logger.warn('Facebook required login to '+'https://mbasic.facebook.com'+linkPath);
        return null;
    }
    const $ = cheerio.load(html);

    //const url = `https://www.facebook.com/story.php?story_fbid=${storyFbId}&id=${storyId}`;
    const url = $('link[rel="canonical"]').attr('href');
    const $story = $('#m_story_permalink_view').eq(0);
    const $box = $story.find('div > div > div > div').eq(0);
    const $header = $box.find('header').eq(0);
    const $content = $box.find('div > div').eq(0);
    $content.find('a[href^="https://lm.facebook.com/l.php"]').each((_, ele) => {
        const link = $(ele);
        const originalLink = new URL(link.attr('href')).searchParams.get('u');
        if (originalLink) {
            link.attr('href', decodeURIComponent(originalLink));
        }
    });
    const $attach = $story.find('div > div > div > div:nth-child(3)').eq(0);
    const $date = $story.find('footer abbr').eq(0);

    const attachLinkList = $attach
        .find('a')
        .toArray()
        .map((a) => $(a).attr('href'));
    const isAttachAreImageSet = attachLinkList.filter((link) => new RegExp('/photos/').test(link)).length === attachLinkList.length;
    const title = $header.find('h3').text();

    const content = $content.html();
    const date = parseDate($date.text(), 'MMMM D at h:mm A');

    let images = [];
    if (isAttachAreImageSet) {
        images = await Promise.all(attachLinkList.map((link) => parsePhotoPage(link, cache)));
    }

    return {
        url,
        title,
        date,
        content,
        images,
    };
};

const parsePhotoPage = async (linkPath, cache) => {
    const { pathname } = new URL('https://mbasic.facebook.com' + linkPath);
    const cacheKey = `photos${pathname}`;

    const html = await fetchPageHtml2(linkPath, cacheKey, cache);
    if (html === null) {
        logger.warn('Facebook required login to '+'https://mbasic.facebook.com'+linkPath);
        return null;
    }
    const $ = cheerio.load(html);

    const title = $('#MPhotoContent div.msg > a > strong').first().text();
    //const url = `https://www.facebook.com${pathname}`;
    const url = $('link[rel="canonical"]').attr('href');
    const $content = $('#MPhotoContent div.msg > div');
    const content = $content.html();
    const image_main = $('#MPhotoContent div.desc.attachment > span > div > span > a[target=_blank].sec').attr('href');
    const image_hires = $('#MPhotoContent div.desc.attachment a[href^="https"]').attr('href');
    const image = image_hires || image_main;
    const $date = $('.desc abbr').eq(0);
    const date = parseDate($date.text(), 'MMM D');

    return {
        title,
        date,
        url,
        content,
        image,
    };
};

module.exports = async (ctx) => {
    const { id } = ctx.params;
    const pageId = encodeURIComponent(id);
    const linkPath = `/${pageId}`;

    const html = await fetchPageHtml2(linkPath, pageId, ctx.cache);
    const $ = cheerio.load(html);

    var itemLinks = $('footer > div:nth-child(2) > a:nth-child(1)')
        .toArray()
        .map((a) => $(a).attr('href'));
    if ( itemLinks.length === 0 ) {
        itemLinks = $('#timelineBody a')
        .toArray()
        .filter((a) => a.innerText == 'Full Story');
        logger.debug(itemLinks);
    }
    if ( itemLinks.length === 0 ) {
        throw new Error('Unable to fetch posts');
    }

    const items = await Promise.all(
        itemLinks.map(async (itemLink) => {
            if (new RegExp(`^/.+/photos/`).test(itemLink)) {
                const data = await parsePhotoPage(itemLink, ctx.cache);
                return {
                    title: data.title,
                    link: data.url,
                    pubDate: data.date,
                    description: `<img src="${data.image}"><br>${data.content}`,
                    enclosure_url: data.image,
                };
            }
            if (new RegExp(`^/story.php`).test(itemLink)) {
                const data = await parseStoryPage(itemLink, ctx.cache);
                if (data === null) {
                    return null;
                }
                const isSingleImageStory = data.images.length === 1;
                const isEmptyImageList = data.images.length === 0;

                let desc = '';
                desc += data.images.map((image) => `<img src="${image.image}"><br>${image.content}`).join('<br>');
                if (!isSingleImageStory) {
                    !isEmptyImageList && (desc += '<br>');
                    desc += data.content;
                }

                var enclosure_url = null;
                if ( data.images && data.images[0] && data.images[0].image ) {
                    enclosure_url = data.images[0].image;
                }

                return {
                    title: data.title,
                    link: data.url,
                    enclosure_url,
                    pubDate: data.date,
                    description: desc,
                };
            }
        })
    );

    ctx.state.data = {
        title: $('#m-timeline-cover-section h1 span').text(),
        link: `https://www.facebook.com/${pageId}`,
        description: $('#sub_profile_pic_content>div>div:nth-child(3) div>span').find('br').replaceWith('\n').text(),
        item: items.filter((item) => !!item),
    };
};
