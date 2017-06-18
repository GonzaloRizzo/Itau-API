const debug = require('debug')('itau-api');
const request = require('request-promise-native');
const { URL } = require('url');
const { b64decode } = require('./utils.js');

const ErrorCodes = {
  10010: 'Bad Login',
  10020: 'Bad Password',
};

/**
 * Class that allows you to access to your Itau account
 */
module.exports = class ItauAPI {


  /**
   * Creates an ItauAPI object
   * @param {String} - Your ID
   * @param {String} - A base64 representation of your password
   */
  constructor(id, password) {
    debug('Created new api for %s', id);

    this._id = id;
    this._pass = b64decode(password);
    this.accounts = [];

    // Default request values
    this._baseUrl = 'https://www.itaulink.com.uy/trx/';
    this._rq = request.defaults({
      baseUrl: this._baseUrl,
      jar: request.jar(),
      resolveWithFullResponse: true,
      followRedirect: false,
    });
  }


  /**
   * Logins with the provided credentials
   * @return {Promise}
   */
  login() {
    debug('Loging in');
    return this._doLogin()
      .then((res) => {
        const redirect = new URL(res.headers.location);

        debug('Login redirected to %s', redirect);

        if (redirect.pathname === '/trx/') {
          return this._downloadAccounts();
        }

        const code = redirect.searchParams.get('message_code');
        const codeMessage = ErrorCodes[code] || 'Unknown error';

        debug('Login failied! %d: %s', code, codeMessage);

        throw new Error(codeMessage);
      });
  }


  /**
   * Returns the transactions on the given month as an array of objects with
   * the following keys:
   *   - type
   *   - description
   *   - extraDescription
   *   - amount
   *   - endBalance
   *   - date
   */
  getMonth(hash, month, year) {
    debug('Requesting movements for %d/%d', month, year);
    year = parseInt(year);
    month = parseInt(month);

    // Year must be in a two digit format, eg. '17' for '2017'
    if (year > 2000) {
      year -= 2000;
    }

    const movementTypes = {
      D: 'expense',
      C: 'income',
    };

    return this._downloadMonth(hash, month, year)
    .then(movements => movements.map(movement => ({
      type: movementTypes[movement.tipo],
      description: movement.descripcion,
      extraDescription: movement.descripcionAdicional,
      amount: movement.tipo === 'D' ? movement.importe * -1 : movement.importe,
      endBalance: movement.saldo,
      date: new Date(movement.fecha.millis),
    })))
    .catch((err) => {
      if ('response' in err) {
        const location = err.response.headers.location || '';
        if (location.endsWith('/trx/expiredSession')) {
          return this.login().then(() => this.getMonth());
        }
      }
      return Promise.reject(err);
    });
  }


  /**
   * Sends your login credentials.
   * Needs to GET /trx afterwards to finish the login
   * @return {Promise}
   */
  _doLogin() {
    debug('Sending credentials to /doLogin');
    return this._rq({
      url: '/doLogin',
      method: 'POST',
      simple: false,
      form: {
        tipo_documento: 1,
        tipo_usuario: 'R',
        nro_documento: this._id,
        pass: this._pass,
        // id: 'login',
        // segmento: 'panelPersona',
        // password: this._pass,
        // empresa_aux: '',
        // pwd_empresa: '',
        // usuario_aux: '',
        // pwd_usuario: '',
        // empresa: '',
        // usuario: '',
      },
    });
  }


  /**
   * Downloads trx and parses the accounts
   */
  _downloadAccounts() {
    debug('Downloading trx');
    return this._rq.get('/').then((res) => {
      debug('Parsing trx');
      const lines = res.body.split('\n');
      const matchedLine = lines.find(
        line => line.includes('var mensajeUsuario = JSON.parse',
      ));
      const JSONMatcher = /JSON\.parse\((['"])(.*)\1\)/;
      const userData = JSON.parse(JSONMatcher.exec(matchedLine)[2]);
      debug('Parsed');

      debug('Parsing JSON');
      this.accounts = [
        ...userData.cuentas.caja_de_ahorro,
        ...userData.cuentas.cuenta_corriente,
        ...userData.cuentas.cuenta_recaudadora,
        ...userData.cuentas.cuenta_de_ahorro_junior,
      ].map(account => ({
        type: account.tipoCuenta,
        id: account.idCuenta,
        user: account.nombreTitular,
        currency: account.moneda,
        balance: account.saldo,
        hash: account.hash,
        customerHash: account.hashCustomer,
        customer: account.customer,

      }));
      debug('Parsed');
    });
  }

  /**
   * Downloads raw movements
   */
  _downloadMonth(hash, month, year) {
    const date = new Date();
    const currentMonth = date.getMonth() + 1;
    const currentYear = date.getFullYear() - 2000;

    if (month === currentMonth && year === currentYear) {
      return this._rq.post({
        url: `/cuentas/1/${hash}/mesActual`,
        json: true,
        resolveWithFullResponse: false,
      }).then((res) => {
        const data = res.itaulink_msg.data;
        return data.movimientosMesActual.movimientos;
      });
    } else if (month > currentMonth && year === currentYear) {
      return Promise.reject(Error('Future month'));
    }
    return this._rq.post({
      url: `/cuentas/1/${hash}/${month}/${year}/consultaHistorica`,
      json: true,
      resolveWithFullResponse: false,
    }).then((res) => {
      const data = res.itaulink_msg.data;
      return data.mapaHistoricos.movimientosHistoricos.movimientos;
    });
  }


};
