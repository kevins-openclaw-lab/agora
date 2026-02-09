/**
 * Blog API routes
 * GET /api/blog/posts — list all posts (metadata only, sorted by date desc)
 * GET /api/blog/posts/:slug — get full post content (markdown + HTML)
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const POSTS_DIR = path.join(__dirname, '..', 'blog', 'posts');

// Configure marked for clean output
marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * Read and parse a single markdown file
 */
function parsePost(filename) {
  const slug = filename.replace(/\.md$/, '');
  const filePath = path.join(POSTS_DIR, filename);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(raw);
  
  return {
    slug,
    title: data.title || slug,
    date: data.date ? new Date(data.date).toISOString().split('T')[0] : null,
    author: data.author || 'Agora',
    description: data.description || '',
    tags: data.tags || [],
    content, // raw markdown
  };
}

/**
 * GET /api/blog/posts
 * Returns metadata for all posts, sorted by date descending
 */
router.get('/posts', (req, res) => {
  try {
    if (!fs.existsSync(POSTS_DIR)) {
      return res.json({ posts: [] });
    }

    const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
    const posts = files.map(f => {
      const post = parsePost(f);
      // Return metadata only (no content)
      return {
        slug: post.slug,
        title: post.title,
        date: post.date,
        author: post.author,
        description: post.description,
        tags: post.tags,
      };
    });

    // Sort by date descending
    posts.sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return new Date(b.date) - new Date(a.date);
    });

    res.json({ posts });
  } catch (err) {
    console.error('Blog list error:', err);
    res.status(500).json({ error: 'Failed to load posts' });
  }
});

/**
 * GET /api/blog/posts/:slug
 * Returns full post with rendered HTML content
 */
router.get('/posts/:slug', (req, res) => {
  try {
    const slug = req.params.slug.replace(/[^a-z0-9_-]/gi, '');
    const filePath = path.join(POSTS_DIR, slug + '.md');

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = parsePost(slug + '.md');
    const html = marked(post.content);

    res.json({
      slug: post.slug,
      title: post.title,
      date: post.date,
      author: post.author,
      description: post.description,
      tags: post.tags,
      content: post.content,
      html,
    });
  } catch (err) {
    console.error('Blog post error:', err);
    res.status(500).json({ error: 'Failed to load post' });
  }
});

module.exports = router;
