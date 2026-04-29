<template>
  <div class="admin-shell">
    <aside class="sidebar">
      <strong><%= appName %></strong>
      <nav>
        <a>Overview</a>
        <a>Users</a>
        <a>Reports</a>
      </nav>
    </aside>
    <main class="content">
      <header>
        <h1>Dashboard</h1>
        <button>New record</button>
      </header>
      <section class="stats">
        <article>
          <span>Revenue</span>
          <strong>$42,860</strong>
        </article>
        <article>
          <span>Active users</span>
          <strong>12,408</strong>
        </article>
        <article>
          <span>Tasks</span>
          <strong>86</strong>
        </article>
      </section>
    </main>
  </div>
</template>
