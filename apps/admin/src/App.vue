<script setup lang="ts">
import { useRoute } from "vue-router";
import {
  LayoutDashboard,
  Trophy,
  ClipboardCheck,
  Radio,
  History,
  ArrowUpRight,
  Bell,
  Users,
  Flag,
  ListChecks,
  Play,
  Sprout,
  ShieldCheck,
  ChevronRight,
} from "@lucide/vue";
const route = useRoute();
const studentUrl = import.meta.env.VITE_STUDENT_URL;
const menu = [
  { to: "/", text: "工作台", icon: LayoutDashboard },
  { to: "/competitions", text: "比赛管理", icon: Trophy },
  { to: "/reviews", text: "通知审核", icon: ClipboardCheck },
  { to: "/sources", text: "采集来源", icon: Radio },
  { to: "/runs", text: "采集运行", icon: Play },
  { to: "/notifications", text: "通知管理", icon: Bell },
  { to: "/users", text: "用户管理", icon: Users },
  { to: "/teams", text: "招募管理", icon: ListChecks },
  { to: "/reports", text: "举报管理", icon: Flag },
  { to: "/operations", text: "操作记录", icon: History },
];
</script>
<template>
  <div class="admin-shell">
    <aside class="sidebar">
      <RouterLink to="/" class="brand" aria-label="禾伙搭管理端首页"
        ><span class="brand-symbol"><Sprout :size="27" /></span
        ><span
          ><strong>禾伙搭</strong><small>管理工作台</small></span
        ></RouterLink
      >
      <div class="nav-caption">内容与运营</div>
      <nav aria-label="管理端主导航">
        <RouterLink
          v-for="item in menu"
          :key="item.to"
          :to="item.to"
          :aria-label="item.text"
          class="nav-link"
          :class="{ selected: route.path === item.to }"
          ><component :is="item.icon" :size="19" /><span>{{
            item.text
          }}</span></RouterLink
        >
      </nav>
      <div class="sidebar-bottom">
        <a
          v-if="studentUrl"
          :href="studentUrl"
          target="_blank"
          rel="noopener"
          class="student-link"
          >查看学生端 <ArrowUpRight :size="16"
        /></a>
        <div class="workspace-note">
          <ShieldCheck :size="18" /><span
            >管理端前端预览<small>真实管理服务待接入</small></span
          >
        </div>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <div class="breadcrumb">
          <span>禾伙搭</span><ChevronRight :size="14" /><strong>{{
            route.meta.title
          }}</strong>
        </div>
        <div class="topbar-actions">
          <span class="preview-pill"><i />页面预览，未认证</span
          ><RouterLink to="/login" class="account-link"
            ><span class="avatar">禾</span><span>管理员入口</span></RouterLink
          >
        </div>
      </header>
      <div class="preview-banner">
        <span
          ><strong>页面预览</strong>
          管理服务未开放；布局及操作记录示例均单独标注，不代表线上数据。</span
        >
      </div>
      <main id="main-content" class="page-container"><RouterView /></main>
      <footer class="page-footer">
        <span>禾伙搭 · 让合适的人，一起把事情做好。</span
        ><span>前端演示版</span>
      </footer>
    </div>
  </div>
</template>
