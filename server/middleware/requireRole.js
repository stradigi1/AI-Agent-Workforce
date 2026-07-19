// Gates that assume authRequired has already run and populated req.user.

function requireTenantUser(req, res, next) {
  if (!req.user || req.user.user_type !== 'tenant') {
    return res.status(403).json({ error: 'Tenant account required' });
  }
  next();
}

function requireTenantRole(...roles) {
  return (req, res, next) => {
    if (!req.user || req.user.user_type !== 'tenant' || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires one of: ${roles.join(', ')}` });
    }
    next();
  };
}

function requireApprover(req, res, next) {
  if (!req.user || req.user.user_type !== 'tenant') {
    return res.status(403).json({ error: 'Tenant account required' });
  }
  const canApprove = req.user.role === 'Owner' || req.user.can_approve;
  if (!canApprove) return res.status(403).json({ error: 'Approval authority required' });
  next();
}

function requireStradigiRole(...roles) {
  return (req, res, next) => {
    if (!req.user || req.user.user_type !== 'stradigi' || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires Stradigi staff role: ${roles.join(', ')}` });
    }
    next();
  };
}

module.exports = { requireTenantUser, requireTenantRole, requireApprover, requireStradigiRole };
