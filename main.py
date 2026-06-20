import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'multi_agent_system'))
os.environ.setdefault('PORT', '5000')

from app import app

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
