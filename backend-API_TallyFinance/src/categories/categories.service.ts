import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { RedisService, RedisKeys } from '../redis';

interface CategoryRow {
  id: string;
  name: string;
  icon: string | null;
  parent_id: string | null;
  created_at: string;
}

export interface CategoryTree extends CategoryRow {
  children: CategoryRow[];
}

@Injectable()
export class CategoriesService {
  private readonly log = new Logger(CategoriesService.name);

  constructor(
    @Inject('SUPABASE') private readonly supabase: SupabaseClient,
    private readonly redis: RedisService,
  ) {}

  async list(userId: string): Promise<{ categories: CategoryTree[] }> {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id, name, icon, parent_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as CategoryRow[];
    const parents = rows.filter((r) => !r.parent_id);
    const children = rows.filter((r) => r.parent_id);

    const tree: CategoryTree[] = parents.map((p) => ({
      ...p,
      children: children.filter((c) => c.parent_id === p.id),
    }));

    return { categories: tree };
  }

  async create(
    userId: string,
    dto: { name: string; icon?: string; parentId?: string },
  ) {
    // Check max 50
    const { count } = await this.supabase
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if ((count ?? 0) >= 50) {
      return { error: 'MAX_CATEGORIES', message: 'Máximo 50 categorías permitidas.' };
    }

    // Check duplicate (case-insensitive)
    const { data: existing } = await this.supabase
      .from('categories')
      .select('id, name')
      .eq('user_id', userId)
      .ilike('name', dto.name);

    if (existing?.length) {
      return { error: 'DUPLICATE', message: 'Ya tienes una categoría con ese nombre.', existing: existing[0] };
    }

    // Validate parent belongs to user (if provided)
    if (dto.parentId) {
      const { data: parent } = await this.supabase
        .from('categories')
        .select('id, parent_id')
        .eq('id', dto.parentId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!parent) {
        return { error: 'INVALID_PARENT', message: 'Categoría padre no encontrada.' };
      }
      // Max 2 levels: parent can't be a child itself
      if (parent.parent_id) {
        return { error: 'MAX_DEPTH', message: 'No se puede crear una subcategoría dentro de otra subcategoría.' };
      }
    }

    const { data: created, error } = await this.supabase
      .from('categories')
      .insert({
        user_id: userId,
        name: dto.name,
        icon: dto.icon ?? null,
        parent_id: dto.parentId ?? null,
        created_at: new Date().toISOString(),
      })
      .select('id, name, icon, parent_id')
      .single();

    if (error) throw new Error(error.message);

    await this.invalidateCache(userId);
    return { category: created };
  }

  async update(
    userId: string,
    categoryId: string,
    dto: { name?: string; icon?: string; parentId?: string },
  ) {
    // Verify ownership
    const { data: existing } = await this.supabase
      .from('categories')
      .select('id, name')
      .eq('id', categoryId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      return { error: 'NOT_FOUND', message: 'Categoría no encontrada.' };
    }

    // Check duplicate name if changing
    if (dto.name && dto.name.toLowerCase() !== existing.name.toLowerCase()) {
      const { data: dup } = await this.supabase
        .from('categories')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', dto.name)
        .neq('id', categoryId);

      if (dup?.length) {
        return { error: 'DUPLICATE', message: 'Ya tienes una categoría con ese nombre.' };
      }
    }

    const payload: Record<string, any> = {};
    if (dto.name !== undefined) payload.name = dto.name;
    if (dto.icon !== undefined) payload.icon = dto.icon;
    if (dto.parentId !== undefined) payload.parent_id = dto.parentId;

    const { data: updated, error } = await this.supabase
      .from('categories')
      .update(payload)
      .eq('id', categoryId)
      .eq('user_id', userId)
      .select('id, name, icon, parent_id')
      .single();

    if (error) throw new Error(error.message);

    await this.invalidateCache(userId);
    return { category: updated };
  }

  async remove(userId: string, categoryId: string, force = false) {
    // Verify ownership
    const { data: existing } = await this.supabase
      .from('categories')
      .select('id, name, parent_id')
      .eq('id', categoryId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) {
      return { error: 'NOT_FOUND', message: 'Categoría no encontrada.' };
    }

    // Count transactions using this category
    const { count: txCount } = await this.supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', categoryId);

    // Count children
    const { count: childCount } = await this.supabase
      .from('categories')
      .select('id', { count: 'exact', head: true })
      .eq('parent_id', categoryId);

    if ((txCount ?? 0) > 0 && !force) {
      return {
        deleted: false,
        transactionCount: txCount ?? 0,
        childCount: childCount ?? 0,
        message: `Esta categoría tiene ${txCount} transacciones asociadas.`,
      };
    }

    // Nullify transactions category_id
    if ((txCount ?? 0) > 0) {
      await this.supabase
        .from('transactions')
        .update({ category_id: null })
        .eq('category_id', categoryId);
    }

    // Delete children first
    if ((childCount ?? 0) > 0) {
      // Nullify transactions in child categories too
      const { data: childCats } = await this.supabase
        .from('categories')
        .select('id')
        .eq('parent_id', categoryId);

      if (childCats?.length) {
        const childIds = childCats.map((c: any) => c.id);
        await this.supabase
          .from('transactions')
          .update({ category_id: null })
          .in('category_id', childIds);
        await this.supabase
          .from('categories')
          .delete()
          .in('id', childIds);
      }
    }

    // Delete the category
    const { error } = await this.supabase
      .from('categories')
      .delete()
      .eq('id', categoryId)
      .eq('user_id', userId);

    if (error) throw new Error(error.message);

    await this.invalidateCache(userId);
    return {
      deleted: true,
      id: categoryId,
      name: existing.name,
      transactionsAffected: txCount ?? 0,
      childrenDeleted: childCount ?? 0,
    };
  }

  private async invalidateCache(userId: string) {
    try {
      await this.redis.del(RedisKeys.userContext(userId));
      this.log.debug(`[invalidateCache] Cleared ctx for user ${userId}`);
    } catch (err) {
      this.log.warn(`[invalidateCache] Failed to clear cache`, err);
    }
  }
}
